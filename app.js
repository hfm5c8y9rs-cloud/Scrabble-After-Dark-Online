import {WORDS} from './words.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,signInAnonymously,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getDatabase,ref,get,set,onValue,runTransaction,remove} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
const config={apiKey:'AIzaSyDq3iRwJGlHjx-PMmNo_Aq0KKi5ULQnHv0',authDomain:'scrabble-after-dark.firebaseapp.com',databaseURL:'https://scrabble-after-dark-default-rtdb.firebaseio.com',projectId:'scrabble-after-dark',storageBucket:'scrabble-after-dark.firebasestorage.app',messagingSenderId:'503923310198',appId:'1:503923310198:web:f9de0ea2bf6a6d8220a957'};
const fb=initializeApp(config),auth=getAuth(fb),db=getDatabase(fb);let uid=null,code=null,seat=-1,game=null,unsub=null,selected=null,editing=false;
const $=id=>document.getElementById(id),say=(s)=>{$('message').textContent=s},gameRef=c=>ref(db,'games/'+c),seatName=s=>s===0?'You':'Wendy';
const V={A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10};
const TW=['0,0','0,7','0,14','7,0','7,14','14,0','14,7','14,14'],DW=['1,1','2,2','3,3','4,4','7,7','10,10','11,11','12,12','13,13','1,13','2,12','3,11','4,10','10,4','11,3','12,2','13,1'],TL=['1,5','1,9','5,1','5,5','5,9','5,13','9,1','9,5','9,9','9,13','13,5','13,9'],DL=['0,3','0,11','2,6','2,8','3,0','3,7','3,14','6,2','6,6','6,8','6,12','7,3','7,11','8,2','8,6','8,8','8,12','11,0','11,7','11,14','12,6','12,8','14,3','14,11'];
const deck=[['Give your partner a slow 30-second kiss.','Name three things you find irresistible about your partner.','Whisper a compliment in your partner’s ear.','Describe your favorite romantic memory together.','Ask your partner where they would like a gentle kiss.','Tell your partner when you last found them especially attractive.','Hold each other close for one minute.','Describe your ideal date night.'],['Give your partner a two-minute shoulder massage.','Share a private romantic fantasy you are comfortable discussing.','Ask what kind of affectionate touch your partner enjoys most.','Choose a song for a slow dance.','Describe an outfit you find particularly attractive.','Kiss for one minute without speaking.','Describe a romantic surprise you would enjoy.','Tell your partner something new you would like to explore together.'],['Ask one intimate question; answering is optional.','Describe an ideal private evening together.','Share a desire you have not talked about much.','Let your partner choose a comfortable way to be held or kissed.','Take two minutes to focus entirely on your partner.','Suggest a new mutually welcome romantic experience.','Each share something you would like more of in your time together.','Choose a mutually agreed romantic reward for after the game.']];
const k=(r,c)=>r+','+c,prem=(r,c)=>{let q=k(r,c);return TW.includes(q)?'tw':DW.includes(q)?'dw':TL.includes(q)?'tl':DL.includes(q)?'dl':''},clone=x=>JSON.parse(JSON.stringify(x));
const initial=()=>({status:'lobby',players:{},names:{},ready:{},secrets:{},scores:[0,0],tiles:{},turn:0,starting:Math.random()<.5?0:1,phase:'play',draws:[[],[],[]],bag:makeBag(),racks:{0:[],1:[]},moves:[],challenge:null,ended:false,version:0});
const player=()=>game?(game.starting+game.turn)%2:0,round=()=>Math.min(2,Math.floor((game?.turn||0)/8)),canAct=()=>game?.status==='playing'&&seat===player(),isOwner=()=>seat>=0&&game?.players?.[seat]===uid;
// Both players must explicitly opt in; one decline skips the challenge.
const choiceStatus=challenge=>{if(!challenge)return 'pending';const r=challenge.responses||{};if(r[0]==='declined'||r[1]==='declined')return 'declined';return r[0]==='accepted'&&r[1]==='accepted'?'accepted':'pending'};
const resetFields=()=>{$('word').value='';$('blanks').value='';$('word').dataset.last='';selected=null;editing=false};
const DISTRIBUTION={A:9,B:2,C:2,D:4,E:12,F:2,G:3,H:2,I:9,J:1,K:1,L:4,M:2,N:6,O:8,P:2,Q:1,R:6,S:4,T:6,U:4,V:2,W:2,X:1,Y:2,Z:1,'?':2};
const makeBag=()=>Object.entries(DISTRIBUTION).flatMap(([l,n])=>Array(n).fill(l)).sort(()=>Math.random()-.5);
// Board styling is installed by app.js so an older index.html cannot hide the grid.
const boardStyle=document.createElement('style');
boardStyle.textContent=`#board{display:grid!important;grid-template-columns:repeat(15,minmax(0,1fr))!important;width:100%!important;max-width:690px;margin:12px auto;gap:2px;aspect-ratio:1/1;visibility:visible!important}#board .sq{display:flex!important;align-items:center;justify-content:center;min-width:0!important;min-height:0!important;padding:0!important;border:1px solid #8d6773;border-radius:2px;font-size:clamp(8px,1.6vw,15px);font-weight:700;color:#38252c;background:#e3d4c8;aspect-ratio:1/1}#board .sq.tw{background:#d8788c}#board .sq.dw{background:#eab2bf}#board .sq.tl{background:#81a6ce}#board .sq.dl{background:#bfd1e9}#board .sq.placed{background:#f0d2a4;color:#38251a}#board .sq.selected{outline:3px solid #f2ba5e;outline-offset:-2px}#board .sq:disabled{opacity:1!important}#tileRack{width:100%;max-width:690px;margin:12px auto!important}#play{min-width:0}`;
document.head.append(boardStyle);
// Firebase Realtime Database omits empty objects/arrays when serializing a snapshot.
// Normalize every snapshot BEFORE attempting to draw the board or calculate a move.
function normalizeGame(g){
 if(!g)return g;
 if(!g.tiles || typeof g.tiles!=='object')g.tiles={};
 if(!g.racks || typeof g.racks!=='object')g.racks={};
 if(!Array.isArray(g.racks[0]))g.racks[0]=[];
 if(!Array.isArray(g.racks[1]))g.racks[1]=[];
 if(!Array.isArray(g.draws))g.draws=[[],[],[]];
 for(let i=0;i<3;i++)if(!Array.isArray(g.draws[i]))g.draws[i]=[];
 if(!Array.isArray(g.moves))g.moves=[];
 if(!Array.isArray(g.scores))g.scores=[0,0];
 if(!g.ready)g.ready={};
 return g;
}
const rackFor=s=>game?.racks?.[s]||[];
let pending={},chosenTile=null;
function evaluate(g=game){
 const entries=Object.entries(pending).map(([pos,t])=>({pos,...t,r:+pos.split(',')[0],c:+pos.split(',')[1]}));
 if(!entries.length)return {error:'Place tiles from your rack on the board.'};
 if(entries.length>7)return {error:'Maximum seven tiles per turn.'};
 const rows=new Set(entries.map(t=>t.r)),cols=new Set(entries.map(t=>t.c));
 if(rows.size>1&&cols.size>1)return {error:'Place tiles in one row or column.'};
 const horizontal=rows.size===1;let dr=horizontal?0:1,dc=horizontal?1:0;
 let r=Math.min(...entries.map(t=>t.r)),c=Math.min(...entries.map(t=>t.c));
 while(r-dr>=0&&c-dc>=0&&g.tiles[k(r-dr,c-dc)]){r-=dr;c-=dc}
 let word='',main=0,mult=1,connected=false,cross=0,used=[],crosswords=[];
 for(let rr=r,cc=c;rr<15&&cc<15;rr+=dr,cc+=dc){let pos=k(rr,cc),t=pending[pos]||g.tiles[pos];if(!t)break;
 word+=t.letter;
 if(!pending[pos]){main+=t.blank?0:V[t.letter];connected=true;continue}
 let val=t.blank?0:V[t.letter],p=prem(rr,cc);main+=val*(p==='dl'?2:p==='tl'?3:1);mult*=p==='dw'?2:p==='tw'?3:1;used.push({r:rr,c:cc,letter:t.letter,blank:!!t.blank,rackIndex:t.rackIndex});
 let before=[],after=[],cr=rr-dc,cl=cc-dr;while(cr>=0&&cl>=0&&g.tiles[k(cr,cl)]){before.unshift(g.tiles[k(cr,cl)]);cr-=dc;cl-=dr}cr=rr+dc;cl=cc+dr;while(cr<15&&cl<15&&g.tiles[k(cr,cl)]){after.push(g.tiles[k(cr,cl)]);cr+=dc;cl+=dr}
 if(before.length+after.length){connected=true;crosswords.push(before.map(x=>x.letter).join('')+t.letter+after.map(x=>x.letter).join(''));cross+=(before.concat(after).reduce((a,x)=>a+(x.blank?0:V[x.letter]),0)+val*(p==='dl'?2:p==='tl'?3:1))*(p==='dw'?2:p==='tw'?3:1)}
 }
 if(used.length!==entries.length)return {error:'Tiles must form a continuous word.'};
 if(word.length<2)return {error:'Play a word of at least two letters.'};
 if(!Object.keys(g.tiles).length){if(!used.some(t=>t.r===7&&t.c===7))return {error:'First word must cover the center square.'}}else if(!connected)return {error:'Connect to an existing tile.'};
 if(word.length>15)return {error:'Word exceeds the board.'};
 if(!WORDS.has(word))return {error:`${word} is not in the game dictionary.`};
 for(const w of crosswords)if(!WORDS.has(w))return {error:`Crossword ${w} is not in the game dictionary.`};
 return {word,crosswords,tiles:used,base:main*mult,cross,bingo:used.length===7?50:0,total:main*mult+cross+(used.length===7?50:0)};
}
function chooseSquare(r,c){if(!canAct()||game.phase!=='play'||game.tiles[k(r,c)])return;
 const pos=k(r,c);if(pending[pos]){delete pending[pos];render();return}
 if(chosenTile===null){say('Select a tile in your rack first.');return}
 const rack=rackFor(seat),letter=rack[chosenTile];if(!letter||Object.values(pending).some(t=>t.rackIndex===chosenTile))return;
 let actual=letter;if(letter==='?'){actual=prompt('Blank tile: which letter (A–Z)?','A')?.trim().toUpperCase();if(!/^[A-Z]$/.test(actual||''))return}
 pending[pos]={letter:actual,blank:letter==='?',rackIndex:chosenTile};chosenTile=null;render();
}
function drawToSeven(g,s){g.bag=g.bag||[];g.racks=g.racks||{0:[],1:[]};g.racks[s]=g.racks[s]||[];while(g.racks[s].length<7&&g.bag.length)g.racks[s].push(g.bag.pop())}
function suggestion(w){return ['SEXY','LUST','NAKED','TEASE','DESIRE','PASSION','SULTRY','HOT','FLIRT'].includes(w)?10:['LOVE','KISS','HUG','HEART','SWEET','ROMANCE','ADORE','DARLING','CUDDLE'].includes(w)?5:0}
function preview(){if(!game)return;const e=canAct()&&game.phase==='play'?evaluate():{error:'Waiting for your turn.'};$('validation').textContent=e.error||`${e.word} · ${e.tiles.length} new tiles`;$('submit').disabled=!!e.error;
 if(e.error){$('summary').textContent='';return}
 let bonus=suggestion(e.word);$('summary').textContent=`Word: ${e.base} · Crosses: ${e.cross} · Bingo: ${e.bingo} · After Dark: ${bonus} · Total: ${e.total+bonus}`;
}
function render(){let active=!!game,playing=game?.status==='playing',myturn=canAct();$('welcome').classList.toggle('hidden',active);$('game').classList.toggle('hidden',!active);if(!active)return;
 $('gameCode').textContent=code;$('seatLabel').textContent=`Player ${seat+1}`;$('score0').innerHTML=`Player 1 <strong>${game.scores[0]}</strong>`;$('score1').innerHTML=`Player 2 <strong>${game.scores[1]}</strong>`;
 $('round').textContent='Round '+(round()+1)+' / 3';$('status').textContent=game.status==='lobby'?'Waiting for both secret words':game.status==='ended'?'Game ended':game.phase==='finished'?'Game complete':`Player ${player()+1} · turn ${game.turn+1} of 24`;
 $('lobby').classList.toggle('hidden',game.status!=='lobby');$('play').classList.toggle('hidden',!playing||game.phase!=='play');$('challenge').classList.toggle('hidden',!playing||game.phase!=='challenge');$('finished').classList.toggle('hidden',!playing||game.phase!=='finished');$('ended').classList.toggle('hidden',game.status!=='ended');$('secretInputArea').classList.toggle('hidden',!!game.ready?.[seat]);$('lobbyInfo').textContent=`Your word: ${game.ready?.[seat]?'saved privately':'not submitted'} · Partner: ${game.ready?.[1-seat]?'ready':'waiting'}`;
 $('board').innerHTML='';$('board').style.display=playing?'grid':'none';if(playing){for(let r=0;r<15;r++)for(let c=0;c<15;c++){let b=document.createElement('button'),t=pending[k(r,c)]||game.tiles[k(r,c)],p=prem(r,c);b.className='sq '+(t?'placed':p)+(pending[k(r,c)]?' selected':'');b.textContent=t?t.letter:({tw:'TW',dw:'DW',tl:'TL',dl:'DL'}[p]||'');b.disabled=!myturn||game.phase!=='play';b.setAttribute('aria-label',`Row ${r+1}, column ${c+1}`);b.onclick=()=>chooseSquare(r,c);$('board').append(b)}}
 let rack=$('tileRack');if(!rack){rack=document.createElement('div');rack.id='tileRack';rack.style.cssText='display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin:14px 0';$('board').insertAdjacentElement('afterend',rack)}rack.innerHTML='';if(playing&&game.phase==='play'){rackFor(seat).forEach((letter,i)=>{let b=document.createElement('button');b.textContent=letter==='?'?'BLANK':`${letter} ${V[letter]||0}`;b.disabled=!myturn||Object.values(pending).some(t=>t.rackIndex===i);b.style.cssText=`min-width:40px;min-height:48px;border:2px solid ${chosenTile===i?'#e6ac64':'#9c7383'};border-radius:7px;background:#e8d2a2;color:#302315;font-weight:bold`;b.onclick=()=>{chosenTile=i;render()};rack.append(b)})}
 for(const id of ['submit','skip','undo'])$(id).disabled=!myturn||game.phase!=='play';
 const ch=game.challenge,decision=choiceStatus(ch),responses=ch?.responses||{},inChallenge=playing&&game.phase==='challenge';
 const myChoice=responses[seat],otherChoice=responses[1-seat];
 $('acceptChallenge').disabled=!inChallenge||!isOwner()||decision!=='pending'||!!myChoice;
 $('declineChallenge').disabled=!inChallenge||!isOwner()||decision!=='pending'||!!myChoice;
 $('challengeChoices').classList.toggle('hidden',!inChallenge||decision!=='pending'||!!myChoice);
 $('challengeResponses').textContent=inChallenge?`Your response: ${myChoice||'waiting'} · Partner: ${otherChoice||'waiting'}`:'';
 $('challengeGuidance').textContent=inChallenge?'Both players choose independently. Either person may decline, without penalty.':'';
 $('challengeDecision').textContent=!inChallenge?'':decision==='declined'?'Declined — challenge skipped. No penalty.':decision==='accepted'?'Accepted by both — enjoy the challenge when you are both ready.':myChoice?'Waiting for your partner to respond.':'Choose Accept or Decline. Your partner sees the same challenge.';
 $('next').disabled=!inChallenge||!myturn||decision==='pending';
 $('undoChallenge').disabled=!inChallenge||!myturn||Object.keys(responses).length>0;
 for(const id of ['word','blanks','dir']){let el=$(id);if(el)el.closest('label,div')?.classList.add('hidden')}
 $('card').textContent=game.challenge?.text||'';$('challengeTitle').textContent=`Player ${player()+1} challenge`;$('spectator').classList.toggle('hidden',myturn||!playing);$('spectator').textContent=`Waiting for Player ${player()+1} to finish their turn. Board updates automatically.`;
 if(game.phase==='finished'){$('winner').textContent=game.scores[0]===game.scores[1]?'It’s a tie!':(game.scores[0]>game.scores[1]?'Player 1 wins!':'Player 2 wins!')+` Final score ${game.scores[0]}–${game.scores[1]}.`;$('revealStatus').textContent=game.reveals?.[0]&&game.reveals?.[1]?'Both secret words revealed.':'Both players must reveal their secret words.';$('revealBtn').disabled=!!game.reveals?.[seat];if(game.reveals?.[0]&&game.reveals?.[1]){$('reveals').textContent=`Secret words: ${game.reveals[0]} / ${game.reveals[1]}`}}
 preview();}
async function mutate(fn){if(!code||!isOwner())return;try{const result=await runTransaction(gameRef(code),g=>{if(!g||g.status==='ended'||g.players?.[seat]!==uid)return;g=normalizeGame(g);const out=fn(g);if(out){out.version=(g.version||0)+1;return out}}, {applyLocally:false});if(!result.committed)say('That action could not be completed. The other iPad may have updated the game.')}catch(e){say('Could not save: '+e.message)}}
function subscribe(c,s){code=c;seat=s;sessionStorage.setItem('afterdark-seat',String(s));if(unsub)unsub();unsub=onValue(gameRef(c),snap=>{let old=game,latest=snap.val();if(!latest){game=null;leave();say('This game is no longer available.');return}if(old&&(old.turn!==latest.turn||old.phase!==latest.phase)){pending={};chosenTile=null;resetFields();}game=normalizeGame(latest);try{render()}catch(e){console.error("Board render failed",e);say("Game display error: "+e.message)}},err=>say('Database connection: '+err.message));$('joinCode').value='';say('Connected to game '+c+' · digital board v3.3')}
function leave(){if(unsub){unsub();unsub=null}code=null;seat=-1;game=null;pending={};chosenTile=null;resetFields();render()}
$('create').onclick=async()=>{if(!uid)return say('Connecting to Firebase…');try{for(let i=0;i<12;i++){let c=String(100000+Math.floor(Math.random()*900000)),g=initial();g.players={0:uid};const result=await runTransaction(gameRef(c),old=>old===null?g:undefined,{applyLocally:false});if(result.committed){subscribe(c,0);return}}say('Unable to allocate a game code. Try again.')}catch(e){say(e.message)}};
$('join').onclick=async()=>{
  const c=$('joinCode').value.trim();
  if(!/^\d{6}$/.test(c))return say('Enter a six-digit code.');
  if(!uid)return say('Still connecting to Firebase. Please try again.');
  try{
    const snap=await get(gameRef(c)),g=snap.val();
    if(!g)return say('Game not found. Check the six-digit code.');
    if(g.status==='ended')return say('This game has ended.');
    let s=Object.entries(g.players||{}).find(([,v])=>v===uid)?.[0];
    if(s===undefined){
      if(g.status!=='lobby')return say('This game has already started.');
      if(g.players?.[1]&&g.players[1]!==uid)return say('Player 2 already joined this game.');
      // Restore the seat transaction from the version in which both iPads successfully connected.
      const seatRef=ref(db,`games/${c}/players/1`);
      const result=await runTransaction(seatRef,current=>current===null?uid:current===uid?current:undefined,{applyLocally:false});
      if(!result.committed){
        const current=(await get(seatRef)).val();
        if(current!==uid)return say('Join could not claim seat 2. It currently belongs to another device.');
      }
      const check=(await get(gameRef(c))).val();
      if(!check||check.players?.[1]!==uid)return say('Join was not saved in Firebase. Try again.');
      s='1';
    }
    subscribe(c,Number(s));
  }catch(e){say('Join failed: '+(e.code||'error')+' — '+e.message)}
};
$('leave').onclick=()=>{leave();say('Enter the six-digit code to rejoin.')};
$('secretSave').onclick=async()=>{let w=$('secret').value.trim().toUpperCase();if(!/^[A-Z]{4,8}$/.test(w))return say('Secret word must contain 4–8 letters.');if(!game?.players?.[1])return say('Wait for Wendy to join before submitting words.');try{await set(ref(db,`secrets/${code}/${seat}`),{uid,word:w});await mutate(g=>{if(g.status!=='lobby'||g.ready?.[seat])return;g.ready=g.ready||{};g.ready[seat]=true;if(g.ready[0]&&g.ready[1]){g.status='playing';drawToSeven(g,0);drawToSeven(g,1)}return g});$('secret').value='';say('Your secret word was saved privately.')}catch(e){say(e.message)}};
document.querySelectorAll('input[name="bonus"]').forEach(e=>e.onchange=preview);
$('submit').onclick=async()=>{let e=evaluate();if(e.error)return say(e.error);let before=clone(game),p=player(),bonus=suggestion(e.word);await mutate(g=>{if(g.status!=='playing'||g.phase!=='play'||(g.starting+g.turn)%2!==seat||g.version!==before.version)return;
 let old=game;game=g;let check=evaluate(g);game=old;if(check.error||check.word!==e.word||JSON.stringify(check.tiles)!==JSON.stringify(e.tiles))return;
 const rack=g.racks?.[seat]||[];if(e.tiles.some(t=>rack[t.rackIndex]!== (t.blank?'?':t.letter)))return;
 g.moves=g.moves||[];g.moves.push({player:p,word:e.word,points:e.total+bonus,previous:{tiles:clone(g.tiles),scores:[...g.scores],draws:clone(g.draws),racks:clone(g.racks),bag:[...g.bag],turn:g.turn,phase:'play'}});
 for(let t of e.tiles)g.tiles[k(t.r,t.c)]={letter:t.letter,blank:t.blank};g.racks[seat]=rack.filter((_,i)=>!e.tiles.some(t=>t.rackIndex===i));drawToSeven(g,seat);g.scores[p]+=e.total+bonus;
 let rd=Math.min(2,Math.floor(g.turn/8)),draws=g.draws[rd]||[],available=deck[rd].map((_,i)=>i).filter(i=>!draws.includes(i));if(!available.length){g.draws[rd]=[];available=deck[rd].map((_,i)=>i)}let pick=available[Math.floor(Math.random()*available.length)];g.draws[rd].push(pick);g.challenge={text:deck[rd][pick],player:p,responses:{}};g.phase='challenge';return g});pending={};chosenTile=null};
async function respondToChallenge(response){await mutate(g=>{
 if(g.status!=='playing'||g.phase!=='challenge'||!g.challenge||!['accepted','declined'].includes(response))return;
 if(choiceStatus(g.challenge)!=='pending')return;
 g.challenge.responses=g.challenge.responses||{};
 if(g.challenge.responses[seat])return;
 g.challenge.responses[seat]=response;return g;
 });}
$('acceptChallenge').onclick=()=>respondToChallenge('accepted');
$('declineChallenge').onclick=()=>respondToChallenge('declined');
$('next').onclick=()=>mutate(g=>{
 if(g.status!=='playing'||g.phase!=='challenge'||(g.starting+g.turn)%2!==seat||choiceStatus(g.challenge)==='pending')return;
 g.turn++;g.phase=g.turn>=24?'finished':'play';g.challenge=null;return g;
});
function undo(g){if((g.starting+g.turn)%2!==seat)return;let m=g.moves?.at(-1);if(!m||m.player!==seat)return;g.tiles=m.previous.tiles;g.scores=m.previous.scores;g.draws=m.previous.draws;if(m.previous.racks)g.racks=m.previous.racks;if(m.previous.bag)g.bag=m.previous.bag;g.turn=m.previous.turn;g.phase='play';g.challenge=null;g.moves.pop();return g}
$('undo').onclick=()=>mutate(g=>{if(g.phase!=='play')return;return undo(g)});$('undoChallenge').onclick=()=>mutate(g=>{if(g.phase!=='challenge'||Object.keys(g.challenge?.responses||{}).length)return;return undo(g)});
$('skip').onclick=()=>mutate(g=>{if(g.phase!=='play'||(g.starting+g.turn)%2!==seat)return;g.moves=g.moves||[];g.moves.push({player:seat,word:null,points:0,previous:{tiles:clone(g.tiles),scores:[...g.scores],draws:clone(g.draws),racks:clone(g.racks),bag:[...g.bag],turn:g.turn,phase:'play'}});g.turn++;g.phase=g.turn>=24?'finished':'play';return g});
$('end').onclick=async()=>{if(!confirm('End this shared game for both players? This cannot be undone.'))return;await mutate(g=>{g.status='ended';return g})};
$('revealBtn').onclick=async()=>{if(game?.phase!=='finished')return;try{let snap=await get(ref(db,`secrets/${code}/${seat}`)),w=snap.val()?.word;if(!w)return say('Your secret word could not be found.');await mutate(g=>{if(g.phase!=='finished'||g.reveals?.[seat])return;g.reveals=g.reveals||{};g.reveals[seat]=w;if(g.reveals[0]&&g.reveals[1]){g.secretMatches=[];for(let s=0;s<2;s++){let target=g.reveals[1-s];if(g.moves?.some(m=>m.player===s&&m.word===target)){g.scores[s]+=50;g.secretMatches.push(s)}}}return g})}catch(e){say(e.message)}};
$('rulesBtn').onclick=()=>$('rules').showModal();$('closeRules').onclick=()=>$('rules').close();
onAuthStateChanged(auth,u=>{if(u){uid=u.uid;say('Ready. Create a game or enter your six-digit code.')}else signInAnonymously(auth).catch(e=>say('Firebase sign-in failed: '+e.message))});
