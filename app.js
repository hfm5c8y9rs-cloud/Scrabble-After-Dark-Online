import {WORDS} from './words.js';
import {CARDS,byId,selectChallenge} from './challenges.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,signInAnonymously,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getDatabase,ref,get,set,onValue,runTransaction,remove} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
const config={apiKey:'AIzaSyDq3iRwJGlHjx-PMmNo_Aq0KKi5ULQnHv0',authDomain:'scrabble-after-dark.firebaseapp.com',databaseURL:'https://scrabble-after-dark-default-rtdb.firebaseio.com',projectId:'scrabble-after-dark',storageBucket:'scrabble-after-dark.firebasestorage.app',messagingSenderId:'503923310198',appId:'1:503923310198:web:f9de0ea2bf6a6d8220a957'};
const fb=initializeApp(config),auth=getAuth(fb),db=getDatabase(fb);let uid=null,code=null,seat=-1,game=null,unsub=null,selected=null,editing=false;
// The exchange selection stays local until a single Firebase transaction commits it.
let swapping=false,swapIndices=new Set();
const clearSwap=()=>{swapping=false;swapIndices.clear()};
const $=id=>document.getElementById(id),say=(s)=>{$('message').textContent=s},gameRef=c=>ref(db,'games/'+c),seatName=s=>s===0?'You':'Wendy';
const V={A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10};
const TW=['0,0','0,7','0,14','7,0','7,14','14,0','14,7','14,14'],DW=['1,1','2,2','3,3','4,4','7,7','10,10','11,11','12,12','13,13','1,13','2,12','3,11','4,10','10,4','11,3','12,2','13,1'],TL=['1,5','1,9','5,1','5,5','5,9','5,13','9,1','9,5','9,9','9,13','13,5','13,9'],DL=['0,3','0,11','2,6','2,8','3,0','3,7','3,14','6,2','6,6','6,8','6,12','7,3','7,11','8,2','8,6','8,8','8,12','11,0','11,7','11,14','12,6','12,8','14,3','14,11'];
const k=(r,c)=>r+','+c,prem=(r,c)=>{let q=k(r,c);return TW.includes(q)?'tw':DW.includes(q)?'dw':TL.includes(q)?'tl':DL.includes(q)?'dl':''},clone=x=>JSON.parse(JSON.stringify(x));
const initial=()=>({status:'lobby',players:{},names:{},ready:{},secrets:{},scores:[0,0],tiles:{},turn:0,starting:Math.random()<.5?0:1,phase:'play',draws:[[],[],[]],bag:makeBag(),racks:{0:[],1:[]},moves:[],challenge:null,ended:false,turnStartedAt:null,thinkMs:[0,0],lastTurnMs:0,challengeHistory:[],endRequest:null,version:0});
const player=()=>game?(game.starting+game.turn)%2:0,round=()=>Math.min(2,Math.floor((game?.turn||0)/8)),canAct=()=>game?.status==='playing'&&seat===player(),isOwner=()=>seat>=0&&game?.players?.[seat]===uid;
// Both players must explicitly opt in; one decline skips the challenge.
const choiceStatus=challenge=>{if(!challenge)return 'pending';const r=challenge.responses||{};if(r[0]==='declined'||r[1]==='declined')return 'declined';return r[0]==='accepted'&&r[1]==='accepted'?'accepted':'pending'};
// Two-device challenge progression. Acceptance precedes any interactive prompts.
const challengeCard=ch=>byId.get(ch?.cardId)||null;
function flowDone(ch){
 if(!ch||choiceStatus(ch)!=='accepted'||ch.skipped)return true;
 const card=challengeCard(ch);
 if(!card)return true; // Gracefully finish a challenge created by an older build.
 if(card.kind==='choice'||card.kind==='wildcard'||card.pickerInput||(card.kind==='timed'&&card.options))return ch.selection!==undefined;
 if(card.kind==='reveal'){
  if(card.offerTwo)return Array.isArray(ch.offers)&&ch.offers.length===2&&ch.selection!==undefined;
  if(!ch.entries||typeof ch.entries[0]!=='string'||typeof ch.entries[1]!=='string')return false;
  return !card.selectAfterReveal||ch.selection!==undefined;
 }
 return true;
}
function activityDone(ch){return !ch||choiceStatus(ch)==='declined'||!!ch.skipped||flowDone(ch)&&timerSatisfied(ch)}
function recentSeen(){try{return JSON.parse(localStorage.getItem('afterdark-seen-40')||'[]')}catch{return []}}
function rememberCard(id){if(!id)return;try{const seen=recentSeen().filter(x=>x!==id);seen.push(id);localStorage.setItem('afterdark-seen-40',JSON.stringify(seen.slice(-120)))}catch{}}
const newChallenge=card=>({cardId:card.id,title:card.title,text:card.prompt,player:0,responses:{},durationSeconds:card.durationSeconds||0});
const safeInput=value=>String(value||'').trim().replace(/\s+/g,' ').slice(0,160);
function mkButton(label,callback){const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.onclick=callback;return btn}
function showFlowOptions(options,handler){
 const area=$('flowOptions');area.innerHTML='';
 for(let i=0;i<options.length;i++)area.append(mkButton(options[i],()=>handler(i)));
 area.classList.toggle('hidden',!options.length);
}
function showFlowInputs({label='Your answer',two=false,submit='Submit answer',onSubmit}){
 $('flowInputWrap').classList.remove('hidden');$('flowInputLabel').textContent=label;
 $('flowInput2Wrap').classList.toggle('hidden',!two);
 $('flowSubmit').textContent=submit;
 $('flowSubmit').onclick=()=>{const v=safeInput($('flowInput').value),w=safeInput($('flowInput2').value);if(!v||(two&&!w))return say('Enter '+(two?'both options.':'an answer.'));onSubmit(v,w)};
}
async function saveFlow(fn){return mutate(g=>{
 if(g.status!=='playing'||g.phase!=='challenge'||choiceStatus(g.challenge)!=='accepted'||g.challenge?.skipped)return;
 const card=challengeCard(g.challenge);if(!card)return;
 return fn(g.challenge,card)?g:undefined;
})}
function renderChallengeFlow(){
 const ch=game?.challenge,card=challengeCard(ch),active=game?.status==='playing'&&game.phase==='challenge'&&choiceStatus(ch)==='accepted';
 const root=$('challengeFlow');root.classList.toggle('hidden',!active);
 if(!active)return;
 $('flowInputWrap').classList.add('hidden');$('flowOptions').classList.add('hidden');$('flowReveal').classList.add('hidden');
 $('flowLead').textContent='';$('flowStatus').textContent='';$('flowOptions').innerHTML='';
 $('flowSkip').disabled=!!ch.skipped;
 if(ch.skipped){$('flowStatus').textContent='Activity skipped — no penalty. The word-playing player may advance.';return}
 if(!card){$('flowStatus').textContent='Enjoy the challenge, then advance the turn.';return}
 const actor=ch.player,picker=1-actor,myPicker=seat===picker,myActor=seat===actor;
 const selected=ch.selection!==undefined;
 const selectionText=selected?(card.options?.[ch.selection]||ch.choiceText||ch.offers?.[ch.selection]||ch.entries?.[ch.selection]||'Your selection'):'';
 if(card.kind==='choice'||card.kind==='wildcard'||card.pickerInput||(card.kind==='timed'&&card.options)){
  if(selected){$('flowReveal').textContent='Chosen: '+selectionText;$('flowReveal').classList.remove('hidden');$('flowStatus').textContent='Carry out the selected challenge, then continue.';return}
  $('flowLead').textContent=card.pickerPrompt||(myPicker?'Choose what your partner will do.':'Your partner is choosing an option.');
  if(!myPicker){$('flowStatus').textContent='Waiting for Player '+(picker+1)+' to make the selection.';return}
  if(card.pickerInput){showFlowInputs({label:card.pickerPrompt||'Choose a song or genre',submit:'Send choice',onSubmit:v=>saveFlow(ch=>{if(ch.selection!==undefined)return false;ch.selection=-1;ch.choiceText=v;return true})});return}
  showFlowOptions(card.options||[],i=>saveFlow(ch=>{if(ch.selection!==undefined)return false;ch.selection=i;return true}));return;
 }
 if(card.kind==='reveal'){
  if(card.offerTwo){
   if(!Array.isArray(ch.offers)){
    if(myActor){$('flowLead').textContent='Enter two options for your partner to choose.';
     showFlowInputs({label:'Option A',two:true,submit:'Send both options',onSubmit:(a,b)=>saveFlow(ch=>{if(ch.offers)return false;ch.offers=[a,b];return true})});
    }else $('flowStatus').textContent='Waiting for Player '+(actor+1)+' to create two options.';
    return;
   }
   if(!selected){$('flowLead').textContent='Choose between the two proposed activities.';
    if(myPicker)showFlowOptions(ch.offers,i=>saveFlow(ch=>{if(ch.selection!==undefined)return false;ch.selection=i;return true}));
    else $('flowStatus').textContent='Waiting for your partner to choose.';
    return;
   }
   $('flowReveal').textContent='Your partner chose: '+ch.offers[ch.selection];$('flowReveal').classList.remove('hidden');return;
  }
  const entries=ch.entries||{},hasMine=typeof entries[seat]==='string',both=typeof entries[0]==='string'&&typeof entries[1]==='string';
  if(!both){
   if(!hasMine){
    $('flowLead').textContent=card.presetEntryOptions?'Pick a secret answer; both will appear together.':'Enter your answer. It will appear to both players after both submit.';
    if(card.presetEntryOptions)showFlowOptions(card.presetEntryOptions,i=>saveFlow(ch=>{ch.entries=ch.entries||{};if(ch.entries[seat])return false;ch.entries[seat]=card.presetEntryOptions[i];return true}));
    else showFlowInputs({label:card.id==='R3-19'?'Your preference (and what to save for later)':'Your private answer',submit:'Lock in answer',onSubmit:v=>saveFlow(ch=>{ch.entries=ch.entries||{};if(ch.entries[seat])return false;ch.entries[seat]=v;return true})});
   }else $('flowStatus').textContent='Your answer is saved. Waiting for the other player.';
   return;
  }
  $('flowReveal').classList.remove('hidden');$('flowReveal').textContent='Player 1: '+entries[0]+'\nPlayer 2: '+entries[1];
  if(card.selectAfterReveal&&ch.selection===undefined){
   $('flowLead').textContent=myPicker?'Select one revealed option.':'Your partner is choosing one of the revealed options.';
   if(myPicker)showFlowOptions([entries[0],entries[1]],i=>saveFlow(ch=>{if(ch.selection!==undefined)return false;ch.selection=i;return true}));
  }else $('flowStatus').textContent=card.selectAfterReveal?'Selected: '+entries[ch.selection]:'Both answers revealed. Continue whenever you are ready.';
  return;
 }
 if(card.id==='R3-39'){$('flowLead').textContent='Want to end Scrabble together?';showFlowOptions(['Invite your partner: The Board Can Wait'],()=>{$('end').click()});return}
 $('flowStatus').textContent=card.durationSeconds?'Start the shared countdown below.':'Carry out the challenge, then continue.';
}
const resetFields=()=>{$('word').value='';$('blanks').value='';$('word').dataset.last='';selected=null;editing=false};
const DISTRIBUTION={A:9,B:2,C:2,D:4,E:12,F:2,G:3,H:2,I:9,J:1,K:1,L:4,M:2,N:6,O:8,P:2,Q:1,R:6,S:4,T:6,U:4,V:2,W:2,X:1,Y:2,Z:1,'?':2};
// Fisher-Yates avoids the uneven tile mixing caused by sort(() => Math.random() - .5).
function shuffleBag(tiles){for(let i=tiles.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[tiles[i],tiles[j]]=[tiles[j],tiles[i]]}return tiles}
const makeBag=()=>shuffleBag(Object.entries(DISTRIBUTION).flatMap(([l,n])=>Array(n).fill(l)));
const MIN_EXCHANGE_BAG=7;
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
 if(!Array.isArray(g.thinkMs))g.thinkMs=[0,0];
 if(!Array.isArray(g.challengeHistory))g.challengeHistory=[];
 if(!Number.isFinite(g.thinkMs[0]))g.thinkMs[0]=0;
 if(!Number.isFinite(g.thinkMs[1]))g.thinkMs[1]=0;
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
function chooseSquare(r,c){if(!canAct()||swapping||game.phase!=='play'||game.tiles[k(r,c)])return;
 const pos=k(r,c);if(pending[pos]){delete pending[pos];render();return}
 if(chosenTile===null){say('Select a tile in your rack first.');return}
 const rack=rackFor(seat),letter=rack[chosenTile];if(!letter||Object.values(pending).some(t=>t.rackIndex===chosenTile))return;
 let actual=letter;if(letter==='?'){actual=prompt('Blank tile: which letter (A–Z)?','A')?.trim().toUpperCase();if(!/^[A-Z]$/.test(actual||''))return}
 pending[pos]={letter:actual,blank:letter==='?',rackIndex:chosenTile};chosenTile=null;render();
}
function drawToSeven(g,s){g.bag=g.bag||[];g.racks=g.racks||{0:[],1:[]};g.racks[s]=g.racks[s]||[];while(g.racks[s].length<7&&g.bag.length)g.racks[s].push(g.bag.pop())}
// Bonus eligibility is an explicit, predictable word list, not an AI guess.
// Main word only; normal Scrabble scores, crosswords and the secret-word match are separate.
const ROMANTIC_WORDS=new Set(["LOVE", "KISS", "HUG", "HEART", "SWEET", "ROMANCE", "ADORE", "DARLING", "CUDDLE", "AFFECTION", "EMBRACE", "CHARM", "DEVOTION", "BELOVED", "LOVER", "LOVERS", "ROMANTIC", "LOVING", "DATE", "DATES", "WINK", "WINKS", "BLUSH", "BLUSHES"]);
const SUGGESTIVE_WORDS=new Set(["SEXY", "LUST", "NAKED", "TEASE", "DESIRE", "PASSION", "SULTRY", "HOT", "FLIRT", "SEDUCE", "STEAMY", "SPICY", "NAUGHTY", "RISQUE", "FANTASY", "SENSUAL", "TEMPT", "TINGLE", "KINKY", "CRAVE", "CHEEKY", "INTIMATE", "KISSING", "WHISPER", "LINGERIE"]);
function bonusForWord(w){
 const word=(w||'').trim().toUpperCase();
 return SUGGESTIVE_WORDS.has(word)?{points:10,tier:'Suggestive',word}:ROMANTIC_WORDS.has(word)?{points:5,tier:'Romantic',word}:{points:0,tier:null,word};
}
function setupBonusWords(){
 $('romanticWords').textContent=[...ROMANTIC_WORDS].sort().join(' · ');
 $('suggestiveWords').textContent=[...SUGGESTIVE_WORDS].sort().join(' · ');
}
let toastTimer=null;
function showBonusEvent(event){
 if(!event?.awards?.length)return;
 const awards=event.awards;
 const node=$('bonusToast');
 const secret=event.kind==='secret';
 const label=secret?'SECRET WORD MATCH':awards[0].tier.toUpperCase()+' WORD BONUS';
 $('bonusToastTier').textContent=label;
 $('bonusToastPoints').textContent=awards.map(a=>'+'+a.points).join(' & ');
 $('bonusToastDescription').textContent=awards.map(a=>`Player ${a.player+1} · ${a.word}`).join('  ·  ');
 node.classList.remove('visible','romantic','suggestive','secret');
 void node.offsetWidth; // restart CSS animation for consecutive bonuses
 node.classList.add('visible',secret?'secret':awards[0].tier.toLowerCase());
 if(toastTimer)clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>node.classList.remove('visible'),3000);
}


// Challenge library: 40 unique prompts per round. Timed prompts carry their specific countdown in seconds.
// Within each round, a random challenge is drawn without replacement.
// Timed challenges use an explicit mapping; untimed prompts never start a clock.
const challengeSeconds=ch=>{
 const card=byId.get(ch?.cardId);
 if(!card)return Number(ch?.durationSeconds)||0;
 const selected=ch?.selection;
 const durations=card.optionSeconds;
 return (Array.isArray(durations)&&selected!==undefined?Number(durations[selected]):0)||Number(card.durationSeconds)||0;
};
let serverTimeOffset=0,soundCtx=null,soundEnabled=false,observedTimerKey=null,chimedTimerKey=null;
const serverNow=()=>Date.now()+serverTimeOffset;
// Every client uses the Firebase-adjusted clock and a shared turn start timestamp.
// Challenge time is excluded from word-playing time; clocks never deduct points.
function formatElapsed(ms){
 const seconds=Math.max(0,Math.floor((Number(ms)||0)/1000));
 const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
 return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}
function elapsedThisTurn(g,now=serverNow()){
 if(g?.status!=='playing'||g?.phase!=='play'||!Number.isFinite(g?.turnStartedAt)||!g.turnStartedAt)return 0;
 return Math.max(0,now-g.turnStartedAt);
}
function finishPlayingTime(g,s,now=serverNow()){
 g.thinkMs=g.thinkMs||[0,0];
 const elapsed=elapsedThisTurn(g,now);
 g.thinkMs[s]=(Number(g.thinkMs[s])||0)+elapsed;
 g.lastTurnMs=elapsed;
 g.turnStartedAt=null;
}
function beginNextTurn(g){g.turnStartedAt=g.status==='playing'&&g.phase==='play'?serverNow():null;}
function syncTurnClock(){
 const panel=$('turnClockPanel');if(!panel)return;
 const visible=game?.status==='playing'&&(game.phase==='play'||game.phase==='challenge');
 panel.classList.toggle('hidden',!visible);
 if(!visible)return;
 const active=game.phase==='play',p=player(),elapsed=active?elapsedThisTurn(game):Math.max(0,Number(game.lastTurnMs)||0);
 $('turnClockLabel').textContent=active?`Player ${p+1} is choosing a word`:`Player ${p+1} finished their word`;
 $('turnClockValue').textContent=active&&!(game.turnStartedAt>0)?'—:—':formatElapsed(elapsed);
 const totals=game.thinkMs||[0,0];
 for(let i=0;i<2;i++){
  const live=active&&p===i?elapsed:0;
  $(`thinking${i}`).textContent=formatElapsed((Number(totals[i])||0)+live);
 }
 const late=active&&elapsed>=300000,slow=active&&elapsed>=180000;
 panel.classList.toggle('slow',slow);panel.classList.toggle('late',late);
 $('turnClockFill').style.width=`${Math.min(100,Math.round(elapsed/180000*100))}%`;
 $('turnClockHint').textContent=!active?'Challenge time is not counted toward the turn.':
  !(game.turnStartedAt>0)?'Turn tracking will begin on the next turn in this existing game.':
  late?'Over 5 minutes — still no automatic penalty.':
  slow?'Over the suggested 3-minute pace — no penalty.':
  'Suggested pace: 3 minutes · no automatic point penalty.';
}

// Safari/iPad requires audio to be unlocked by a real tap, not an automatic event.
function enableChime(){
 try{
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio){soundEnabled=false;return}
  if(!soundCtx)soundCtx=new Audio();
  const resume=soundCtx.resume();soundEnabled=true;
  if(resume?.catch)resume.catch(()=>{soundEnabled=false;syncTimerView()});
 }catch(e){console.warn('Chime unavailable',e);soundEnabled=false}
}
function playTimerChime(){
 if(!soundEnabled||!soundCtx||soundCtx.state!=='running')return;
 try{
  const start=soundCtx.currentTime+0.02;
  [784,1047].forEach((freq,i)=>{
   const t=start+i*0.26,osc=soundCtx.createOscillator(),gain=soundCtx.createGain();
   osc.type='sine';osc.frequency.setValueAtTime(freq,t);
   gain.gain.setValueAtTime(0.001,t);
   gain.gain.exponentialRampToValueAtTime(0.18,t+0.035);
   gain.gain.exponentialRampToValueAtTime(0.001,t+0.43);
   osc.connect(gain);gain.connect(soundCtx.destination);
   osc.start(t);osc.stop(t+0.45);
  });
 }catch(e){console.warn('Chime could not play',e)}
}
function timerComplete(ch){return !!(ch?.timer?.endsAt&&serverNow()>=ch.timer.endsAt)}
function timerSatisfied(ch){return choiceStatus(ch)!=='accepted'||!challengeSeconds(ch)||!!ch?.timer?.skipped||timerComplete(ch)}
function syncTimerView(){
 const ch=game?.challenge,seconds=challengeSeconds(ch);
 const active=game?.status==='playing'&&game?.phase==='challenge'&&choiceStatus(ch)==='accepted'&&flowDone(ch)&&!ch?.skipped&&seconds>0&&!ch?.timer?.skipped;
 const curtain=$('timerCurtain');if(!curtain)return;
 curtain.classList.toggle('hidden',!active);
 if(!active){observedTimerKey=null;return}
 $('timerChallenge').textContent=ch.text;
 const timer=ch.timer||{},end=Number(timer.endsAt)||0;
 const started=!!end,remaining=started?Math.max(0,Math.ceil((end-serverNow())/1000)):seconds;
 const finished=started&&serverNow()>=end;
 const key=`${code}:${game.turn}:${end}`;
 if(started&&remaining>0)observedTimerKey=key;
 if(finished&&observedTimerKey===key&&chimedTimerKey!==key){chimedTimerKey=key;playTimerChime()}
 $('timerDisplay').textContent=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;
 $('timerState').textContent=finished?'Time is up!':started?'Challenge underway':'Ready when you both are';
 $('timerStart').classList.toggle('hidden',started);
 $('timerStart').disabled=started||!isOwner();
 $('timerSkip').classList.toggle('hidden',finished);
 $('timerAdvance').classList.toggle('hidden',!finished||seat!==player());
 $('timerWaiting').classList.toggle('hidden',!finished||seat===player());
 $('timerWaiting').textContent=`Finished — waiting for Player ${player()+1} to advance.`;
 $('timerSound').textContent=soundEnabled?'Chime enabled on this iPad':'Tap “Enable Chime” to hear the finish sound on this iPad.';
 $('enableTimerSound').textContent=soundEnabled?'Chime Enabled':'Enable Chime';
 $('enableTimerSound').disabled=soundEnabled;
 $('next').disabled=seat!==player()||!timerSatisfied(ch);
}

function preview(){if(!game)return;const e=swapping?{error:'Select letters from your rack, then confirm the exchange.'}:canAct()&&game.phase==='play'?evaluate():{error:'Waiting for your turn.'};$('validation').textContent=e.error||`${e.word} · ${e.tiles.length} new tiles`;$('submit').disabled=!!e.error;
 if(e.error){$('summary').textContent='';$('bonusPreview').textContent='';return}
 let bonus=bonusForWord(e.word);$('summary').textContent=`Word: ${e.base} · Crosses: ${e.cross} · Bingo: ${e.bingo} · After Dark: ${bonus.points ? bonus.tier+' +'+bonus.points : 'None'} · Total: ${e.total+bonus.points}`;$('bonusPreview').textContent=bonus.points?`${bonus.tier.toUpperCase()} BONUS · ${e.word} earns +${bonus.points} points when played!`:'';
}
function render(){let active=!!game,playing=game?.status==='playing',myturn=canAct();$('welcome').classList.toggle('hidden',active);$('game').classList.toggle('hidden',!active);if(!active)return;
 $('gameCode').textContent=code;$('seatLabel').textContent=`Player ${seat+1}`;$('score0').innerHTML=`Player 1 <strong>${game.scores[0]}</strong>`;$('score1').innerHTML=`Player 2 <strong>${game.scores[1]}</strong>`;
 $('round').textContent='Round '+(round()+1)+' / 3';$('status').textContent=game.status==='lobby'?'Waiting for both secret words':game.status==='ended'?'Game ended':game.phase==='finished'?'Game complete':`Player ${player()+1} · turn ${game.turn+1} of 24`;
 $('lobby').classList.toggle('hidden',game.status!=='lobby');$('play').classList.toggle('hidden',!playing||game.phase!=='play');$('challenge').classList.toggle('hidden',!playing||game.phase!=='challenge');$('finished').classList.toggle('hidden',!playing||game.phase!=='finished');$('ended').classList.toggle('hidden',game.status!=='ended');if(game.status==='ended')$('endedDetails').textContent=game.endReason==='mutual'?`The Board Can Wait. Final scores: ${game.scores[0]}–${game.scores[1]}.`:`Game ended. Final scores: ${game.scores[0]}–${game.scores[1]}.`;$('secretInputArea').classList.toggle('hidden',!!game.ready?.[seat]);$('lobbyInfo').textContent=`Your word: ${game.ready?.[seat]?'saved privately':'not submitted'} · Partner: ${game.ready?.[1-seat]?'ready':'waiting'}`;
 $('board').innerHTML='';$('board').style.display=playing?'grid':'none';if(playing){for(let r=0;r<15;r++)for(let c=0;c<15;c++){let b=document.createElement('button'),t=pending[k(r,c)]||game.tiles[k(r,c)],p=prem(r,c);b.className='sq '+(t?'placed':p)+(pending[k(r,c)]?' selected':'');b.textContent=t?t.letter:({tw:'TW',dw:'DW',tl:'TL',dl:'DL'}[p]||'');b.disabled=!myturn||swapping||game.phase!=='play';b.setAttribute('aria-label',`Row ${r+1}, column ${c+1}`);b.onclick=()=>chooseSquare(r,c);$('board').append(b)}}
 const bagSize=Array.isArray(game.bag)?game.bag.length:0;
 $('bagCount').textContent=`Tiles in bag: ${bagSize} · ${bagSize<MIN_EXCHANGE_BAG?'Exchanges unavailable (fewer than 7 left)':'Exchange 1–7 tiles instead of playing'}`;
 $('swap').disabled=!myturn||swapping||game.phase!=='play'||bagSize<MIN_EXCHANGE_BAG;
 $('swapPanel').classList.toggle('hidden',!swapping||!myturn||game.phase!=='play');
 $('swapStatus').textContent=`${swapIndices.size} tile${swapIndices.size===1?'':'s'} selected · This uses your turn, scores 0 points, and does not trigger a challenge.`;
 $('confirmSwap').disabled=!myturn||!swapping||swapIndices.size===0||bagSize<MIN_EXCHANGE_BAG;
 let rack=$('tileRack');if(!rack){rack=document.createElement('div');rack.id='tileRack';rack.style.cssText='display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin:14px 0';$('board').insertAdjacentElement('afterend',rack)}rack.innerHTML='';if(playing&&game.phase==='play'){rackFor(seat).forEach((letter,i)=>{let b=document.createElement('button'),isMarked=swapIndices.has(i);b.textContent=letter==='?'?'BLANK':`${letter} ${V[letter]||0}`;b.disabled=!myturn||(!swapping&&Object.values(pending).some(t=>t.rackIndex===i));b.className=swapping?(isMarked?'swap-marked':'swap-available'):'';b.setAttribute('aria-pressed',swapping?String(isMarked):'false');b.setAttribute('aria-label',swapping?`${isMarked?'Remove':'Select'} ${letter==='?'?'blank':letter} for exchange`:`Letter ${letter}`);b.style.cssText=`min-width:40px;min-height:48px;border:2px solid ${swapping?(isMarked?'#f6e2ac':'#9c7383'):(chosenTile===i?'#e6ac64':'#9c7383')};border-radius:7px;background:${swapping&&isMarked?'#79334f':'#e8d2a2'};color:${swapping&&isMarked?'#fff1da':'#302315'};font-weight:bold;box-shadow:${swapping&&isMarked?'0 0 0 2px #eebf76':'none'}`;b.onclick=()=>{if(swapping){swapIndices.has(i)?swapIndices.delete(i):swapIndices.add(i)}else chosenTile=i;render()};rack.append(b)})}
 for(const id of ['submit','skip','undo'])$(id).disabled=!myturn||swapping||game.phase!=='play';
 const ch=game.challenge,decision=choiceStatus(ch),responses=ch?.responses||{},inChallenge=playing&&game.phase==='challenge';
 const myChoice=responses[seat],otherChoice=responses[1-seat];
 $('acceptChallenge').disabled=!inChallenge||!isOwner()||decision!=='pending'||!!myChoice;
 $('declineChallenge').disabled=!inChallenge||!isOwner()||decision!=='pending'||!!myChoice;
 $('challengeChoices').classList.toggle('hidden',!inChallenge||decision!=='pending'||!!myChoice);
 $('challengeResponses').textContent=inChallenge?`Your response: ${myChoice||'waiting'} · Partner: ${otherChoice||'waiting'}`:'';
 $('challengeGuidance').textContent=inChallenge?'Both players choose Accept or Decline, then follow the on-screen prompts.':'';
 $('challengeDecision').textContent=!inChallenge?'':decision==='declined'?'Declined — challenge skipped. No penalty.':decision==='accepted'?(challengeSeconds(ch)?'Accepted by both — synchronized challenge timer is ready.':'Accepted — follow the challenge controls below.'):myChoice?'Waiting for your partner to respond.':'Choose Accept or Decline. Your partner sees the same challenge.';
 $('next').disabled=!inChallenge||!myturn||decision==='pending'||!activityDone(ch);
 $('undoChallenge').disabled=!inChallenge||!myturn||Object.keys(responses).length>0;
 for(const id of ['word','blanks','dir']){let el=$(id);if(el)el.closest('label,div')?.classList.add('hidden')}
 $('card').textContent=game.challenge?.text||'';$('challengeTitle').textContent=ch?.title?`After Dark · ${ch.title}`:`Player ${player()+1} challenge`;renderChallengeFlow();renderEndInvitation();$('spectator').classList.toggle('hidden',myturn||!playing);$('spectator').textContent=`Waiting for Player ${player()+1} to finish their turn. Board updates automatically.`;
 if(game.phase==='finished'){$('winner').textContent=game.scores[0]===game.scores[1]?'It’s a tie!':(game.scores[0]>game.scores[1]?'Player 1 wins!':'Player 2 wins!')+` Final score ${game.scores[0]}–${game.scores[1]}.`;$('revealStatus').textContent=game.reveals?.[0]&&game.reveals?.[1]?'Both secret words revealed.':'Both players must reveal their secret words.';$('revealBtn').disabled=!!game.reveals?.[seat];if(game.reveals?.[0]&&game.reveals?.[1]){$('reveals').textContent=`Secret words: ${game.reveals[0]} / ${game.reveals[1]}`;
 $('secretBonusDetails').textContent=(game.secretMatches||[]).length?`Secret match bonus: ${(game.secretMatches||[]).map(s=>`Player ${s+1} +50`).join(' · ')}`:'Secret match bonus: no matches this game.'}}
 syncTimerView();syncTurnClock();preview();}
async function mutate(fn){if(!code||!isOwner())return false;try{const result=await runTransaction(gameRef(code),g=>{if(!g||g.status==='ended'||g.players?.[seat]!==uid)return;g=normalizeGame(g);const out=fn(g);if(out){out.version=(g.version||0)+1;return out}}, {applyLocally:false});if(!result.committed)say('That action could not be completed. The other iPad may have updated the game.');return !!result.committed}catch(e){say('Could not save: '+e.message);return false}}
function subscribe(c,s){code=c;seat=s;sessionStorage.setItem('afterdark-seat',String(s));if(unsub)unsub();unsub=onValue(gameRef(c),snap=>{let old=game,latest=snap.val();if(!latest){game=null;leave();say('This game is no longer available.');return}if(old&&(old.turn!==latest.turn||old.phase!==latest.phase)){pending={};chosenTile=null;clearSwap();resetFields();}game=normalizeGame(latest);if(latest.challenge?.cardId)rememberCard(latest.challenge.cardId);try{render();if(old&&latest.bonusEvent?.id&&latest.bonusEvent.id!==old.bonusEvent?.id)showBonusEvent(latest.bonusEvent)}catch(e){console.error("Board render failed",e);say("Game display error: "+e.message)}},err=>say('Database connection: '+err.message));$('joinCode').value='';say('Connected to game '+c+' · Build 4.1')}
function leave(){clearSwap();if(unsub){unsub();unsub=null}if(toastTimer)clearTimeout(toastTimer);$('bonusToast').classList.remove('visible');observedTimerKey=null;code=null;seat=-1;game=null;pending={};chosenTile=null;resetFields();render()}
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
$('secretSave').onclick=async()=>{let w=$('secret').value.trim().toUpperCase();if(!/^[A-Z]{4,8}$/.test(w))return say('Secret word must contain 4–8 letters.');if(!game?.players?.[1])return say('Wait for Wendy to join before submitting words.');try{await set(ref(db,`secrets/${code}/${seat}`),{uid,word:w});await mutate(g=>{if(g.status!=='lobby'||g.ready?.[seat])return;g.ready=g.ready||{};g.ready[seat]=true;if(g.ready[0]&&g.ready[1]){g.status='playing';drawToSeven(g,0);drawToSeven(g,1);beginNextTurn(g)}return g});$('secret').value='';say('Your secret word was saved privately.')}catch(e){say(e.message)}};
document.querySelectorAll('input[name="bonus"]').forEach(e=>e.onchange=preview);
$('submit').onclick=async()=>{let e=evaluate();if(e.error)return say(e.error);let before=clone(game),p=player();await mutate(g=>{if(g.status!=='playing'||g.phase!=='play'||(g.starting+g.turn)%2!==seat||g.version!==before.version)return;
 let old=game;game=g;let check=evaluate(g);game=old;if(check.error||check.word!==e.word||JSON.stringify(check.tiles)!==JSON.stringify(e.tiles))return;
 const rack=g.racks?.[seat]||[];if(e.tiles.some(t=>rack[t.rackIndex]!== (t.blank?'?':t.letter)))return;
 const tier=bonusForWord(check.word),earned=check.total+tier.points;
 g.moves=g.moves||[];g.moves.push({player:p,word:check.word,points:earned,afterDarkBonus:tier.points,afterDarkTier:tier.tier,previous:{tiles:clone(g.tiles),scores:[...g.scores],draws:clone(g.draws),racks:clone(g.racks),bag:[...g.bag],bonusEvent:g.bonusEvent||null,thinkMs:[...(g.thinkMs||[0,0])],turnStartedAt:g.turnStartedAt||null,lastTurnMs:g.lastTurnMs||0,turn:g.turn,phase:'play'}});
 if(tier.points)g.bonusEvent={id:`word-${g.moves.length}-${g.turn}`,kind:'word',awards:[{player:p,word:check.word,points:tier.points,tier:tier.tier}]};
 for(let t of e.tiles)g.tiles[k(t.r,t.c)]={letter:t.letter,blank:t.blank};g.racks[seat]=rack.filter((_,i)=>!e.tiles.some(t=>t.rackIndex===i));drawToSeven(g,seat);g.scores[p]+=earned;finishPlayingTime(g,p);
 let rd=Math.min(2,Math.floor(g.turn/8)),card=selectChallenge(rd+1,g.challengeHistory||[],recentSeen());if(!card)return;g.challengeHistory.push(card.id);g.challenge={...newChallenge(card),player:p};g.phase='challenge';return g});pending={};chosenTile=null};
async function respondToChallenge(response){await mutate(g=>{
 if(g.status!=='playing'||g.phase!=='challenge'||!g.challenge||!['accepted','declined'].includes(response))return;
 if(choiceStatus(g.challenge)!=='pending')return;
 g.challenge.responses=g.challenge.responses||{};
 if(g.challenge.responses[seat])return;
 g.challenge.responses[seat]=response;return g;
 });}
$('acceptChallenge').onclick=()=>{enableChime();return respondToChallenge('accepted')};
$('flowSkip').onclick=()=>mutate(g=>{if(g.phase!=='challenge'||choiceStatus(g.challenge)!=='accepted'||g.challenge.skipped)return;g.challenge.skipped=true;g.challenge.timer={skipped:true};return g});
$('declineChallenge').onclick=()=>respondToChallenge('declined');
function advanceChallenge(){return mutate(g=>{
 if(g.status!=='playing'||g.phase!=='challenge'||(g.starting+g.turn)%2!==seat||choiceStatus(g.challenge)==='pending'||!activityDone(g.challenge))return;
 g.turn++;g.phase=g.turn>=24?'finished':'play';g.challenge=null;beginNextTurn(g);return g;
})}
$('next').onclick=advanceChallenge;
$('timerAdvance').onclick=advanceChallenge;
$('timerStart').onclick=()=>{
 enableChime();return mutate(g=>{
  const ch=g.challenge;
  if(g.status!=='playing'||g.phase!=='challenge'||choiceStatus(ch)!=='accepted'||!flowDone(ch)||ch.skipped||!challengeSeconds(ch)||ch.timer?.startedAt||ch.timer?.skipped)return;
  const now=serverNow(),duration=challengeSeconds(ch);
  ch.timer={startedAt:now,endsAt:now+duration*1000,durationSeconds:duration};return g;
 });
};
$('timerSkip').onclick=()=>mutate(g=>{
 const ch=g.challenge;if(g.status!=='playing'||g.phase!=='challenge'||choiceStatus(ch)!=='accepted'||!challengeSeconds(ch)||timerComplete(ch))return;
 ch.timer={skipped:true,durationSeconds:challengeSeconds(ch)};return g;
});
$('enableTimerSound').onclick=()=>{enableChime();syncTimerView()};
// Use Firebase's clock offset so the countdown agrees across two devices.
onValue(ref(db,'.info/serverTimeOffset'),snapshot=>{serverTimeOffset=Number(snapshot.val())||0},()=>{});
setInterval(syncTimerView,250);
setInterval(syncTurnClock,1000);
if(typeof document.addEventListener==='function')document.addEventListener('visibilitychange',syncTimerView);
function undo(g){if((g.starting+g.turn)%2!==seat)return;let m=g.moves?.at(-1);if(!m||m.player!==seat)return;g.tiles=m.previous.tiles;g.scores=m.previous.scores;g.draws=m.previous.draws;if(m.previous.racks)g.racks=m.previous.racks;if(m.previous.bag)g.bag=m.previous.bag;g.turn=m.previous.turn;g.phase='play';g.challenge=null;g.bonusEvent=m.previous.bonusEvent||null;if(m.previous.thinkMs)g.thinkMs=m.previous.thinkMs;g.turnStartedAt=m.previous.turnStartedAt||null;g.lastTurnMs=m.previous.lastTurnMs||0;g.moves.pop();return g}
$('undo').onclick=()=>mutate(g=>{if(g.phase!=='play')return;return undo(g)});$('undoChallenge').onclick=()=>mutate(g=>{if(g.phase!=='challenge'||Object.keys(g.challenge?.responses||{}).length)return;return undo(g)});
// Swap any subset of the seven rack tiles. Draw replacements BEFORE returning old tiles.
// Official rules: at least seven tiles must already remain in the bag; the swap uses the turn.
$('swap').onclick=()=>{
 if(!canAct()||game.phase!=='play')return;
 if((game.bag||[]).length<MIN_EXCHANGE_BAG)return say('Scrabble rules require at least seven tiles in the bag to exchange.');
 pending={};chosenTile=null;swapping=true;swapIndices.clear();render();
};
$('cancelSwap').onclick=()=>{clearSwap();render()};
$('confirmSwap').onclick=async()=>{
 if(!swapping||!canAct()||game.phase!=='play')return;
 const picks=[...swapIndices].sort((a,b)=>a-b),before=clone(game),original=before.racks?.[seat]||[];
 if(!picks.length||picks.some(i=>!Number.isInteger(i)||i<0||i>=original.length))return say('Choose at least one tile to exchange.');
 if((before.bag||[]).length<MIN_EXCHANGE_BAG)return say('At least seven tiles must remain in the bag.');
 const success=await mutate(g=>{
  if(g.status!=='playing'||g.phase!=='play'||(g.starting+g.turn)%2!==seat||g.version!==before.version)return;
  const bag=g.bag||[],rack=g.racks?.[seat]||[];
  if(bag.length<MIN_EXCHANGE_BAG||bag.length<picks.length||rack.length!==original.length||picks.some(i=>rack[i]!==original[i]))return;
  const discarded=picks.map(i=>rack[i]);
  const replacements=picks.map(()=>bag.pop());
  const updated=[...rack];picks.forEach((i,n)=>updated[i]=replacements[n]);
  g.racks[seat]=updated;bag.push(...discarded);shuffleBag(bag);
  g.moves=g.moves||[];g.moves.push({player:seat,word:null,kind:'exchange',tileCount:picks.length,points:0,turn:g.turn});
  finishPlayingTime(g,seat);g.turn++;g.phase=g.turn>=24?'finished':'play';beginNextTurn(g);
  return g;
 });
 if(success){clearSwap();pending={};chosenTile=null;render();say(`Exchanged ${picks.length} tile${picks.length===1?'':'s'}. No points — next player's turn.`)}
};
$('skip').onclick=()=>mutate(g=>{if(g.phase!=='play'||(g.starting+g.turn)%2!==seat)return;g.moves=g.moves||[];g.moves.push({player:seat,word:null,points:0,previous:{tiles:clone(g.tiles),scores:[...g.scores],draws:clone(g.draws),racks:clone(g.racks),bag:[...g.bag],thinkMs:[...(g.thinkMs||[0,0])],turnStartedAt:g.turnStartedAt||null,lastTurnMs:g.lastTurnMs||0,turn:g.turn,phase:'play'}});finishPlayingTime(g,seat);g.turn++;g.phase=g.turn>=24?'finished':'play';beginNextTurn(g);return g});
function renderEndInvitation(){
 const active=game?.status==='playing',proposal=game?.endRequest;
 $('end').classList.toggle('hidden',!active||!!proposal);
 $('endInvitation').classList.toggle('hidden',!active||!proposal);
 if(!active||!proposal)return;
 const r=proposal.responses||{},mine=r[seat];
 $('endInvitationText').textContent=mine==='accepted'?'Invitation sent. Waiting for your partner…':`Player ${proposal.from+1} suggests ending Scrabble here. The board can wait.`;
 $('acceptEnd').classList.toggle('hidden',!!mine);
 $('keepPlaying').classList.toggle('hidden',!!mine);
}
$('end').onclick=()=>mutate(g=>{
 if(g.status!=='playing'||g.endRequest)return;
 g.endRequest={from:seat,responses:{[seat]:'accepted'}};return g;
});
$('acceptEnd').onclick=()=>mutate(g=>{
 if(g.status!=='playing'||!g.endRequest||g.endRequest.responses?.[seat])return;
 g.endRequest.responses=g.endRequest.responses||{};
 g.endRequest.responses[seat]='accepted';
 if(g.endRequest.responses[0]==='accepted'&&g.endRequest.responses[1]==='accepted'){
  if(g.phase==='play')finishPlayingTime(g,(g.starting+g.turn)%2);
  g.status='ended';g.endReason='mutual';g.turnStartedAt=null;
 }
 return g;
});
$('keepPlaying').onclick=()=>mutate(g=>{
 if(g.status!=='playing'||!g.endRequest)return;
 g.endRequest=null;return g;
});
$('revealBtn').onclick=async()=>{if(game?.phase!=='finished')return;try{let snap=await get(ref(db,`secrets/${code}/${seat}`)),w=snap.val()?.word;if(!w)return say('Your secret word could not be found.');await mutate(g=>{if(g.phase!=='finished'||g.reveals?.[seat])return;g.reveals=g.reveals||{};g.reveals[seat]=w;if(g.reveals[0]&&g.reveals[1]&&!g.secretAwarded){
 g.secretAwarded=true;g.secretMatches=[];const awards=[];
 for(let s=0;s<2;s++){
  const target=g.reveals[1-s];
  if(g.moves?.some(m=>m.player===s&&m.word===target)){
   g.scores[s]+=50;g.secretMatches.push(s);awards.push({player:s,word:target,points:50,tier:'Secret'});
  }
 }
 if(awards.length)g.bonusEvent={id:'secret-'+g.turn,kind:'secret',awards};
 }return g})}catch(e){say(e.message)}};
setupBonusWords();
$('rulesBtn').onclick=()=>$('rules').showModal();$('closeRules').onclick=()=>$('rules').close();
onAuthStateChanged(auth,u=>{if(u){uid=u.uid;say('Ready. Create a game or enter your six-digit code.')}else signInAnonymously(auth).catch(e=>say('Firebase sign-in failed: '+e.message))});
