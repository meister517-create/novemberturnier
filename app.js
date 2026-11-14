import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, DATA_DOC } from "./firebase-config.js";

/* 43. Novemberturnier – TSC Eintracht Dortmund
   Öffentliche Ansicht + Orga-Bereich. Daten liegen in Firestore (ein Dokument),
   Anmeldung über Firebase Authentication (E-Mail/Passwort). */
var DEFAULT_LOGO="logo-512.png";
var STATE=null,USER=null,FB=null;
var app=document.getElementById("app");
var DRAFT=null,route="home",filter="Alle",tcat="",atab="plan",afilter="Offen",publishing=false,armed=null,armTimer=null;
var DEFAULT_COLORS={primary:"#1F45C9",on:"#FFFFFF"};
var COLOR_PRESETS=[["Royalblau / Weiß","#1F45C9","#FFFFFF"],["Dunkelblau / Weiß","#0E2A6B","#FFFFFF"],["Grün / Weiß","#0F7A3E","#FFFFFF"],["Rot / Weiß","#C62828","#FFFFFF"],["Bordeaux / Weiß","#7A1730","#FFFFFF"],["Schwarz / Gelb","#111111","#FFD400"],["Gelb / Schwarz","#FFD400","#111111"],["Orange / Weiß","#D9480F","#FFFFFF"],["Lila / Weiß","#5B2A86","#FFFFFF"]];
var DEFAULT_FOOD_AREAS=[{id:"tag",name:"Tagsüber",text:"Essen und Getränke in der Halle"},{id:"party",name:"Playersparty",text:"Getränke auf der Playersparty"}];
var MODES=[["semis","Halbfinale"],["place","Platz gegen Platz"],["league","Nur Tabelle"]];
/* Schichtpläne: Bereiche mit Personen je Stunde, im Orga-Bereich änderbar */
var DEFAULT_SHIFT_AREAS=[{id:"caf",name:"Cafeteria",n:2},{id:"grill",name:"Grill- und Bierstand",n:2},{id:"spkO",name:"Sprecherkabine Halle Ost",n:1},{id:"spkW",name:"Sprecherkabine Halle West",n:1}];
var DEFAULT_SHIFT_PW="1996",shDay="",shQ="";
function norm(s){s.settings=s.settings||{};s.teams=s.teams||[];s.matches=s.matches||[];s.menu=s.menu||[];s.info=s.info||[];
  var st=s.settings;
  /* Turnier-Identität: Name, Auflage, Verein – alles im Orga-Bereich änderbar */
  if(typeof st.title!=="string"||!st.title.trim())st.title="Novemberturnier";
  if(!("edition" in st))st.edition=43;
  if(typeof st.club!=="string")st.club="TSC Eintracht Dortmund";
  if(typeof st.dept!=="string")st.dept="Hockey";
  if(!st.colors||!hex2rgb(st.colors.primary)||!hex2rgb(st.colors.on))st.colors=clone(DEFAULT_COLORS);
  /* Speisen & Getränke: erst freischalten, dann aktiv schalten */
  st.foodOn=!!st.foodOn;st.foodLive=!!st.foodLive;
  if(!Array.isArray(s.foodAreas)||!s.foodAreas.length)s.foodAreas=clone(DEFAULT_FOOD_AREAS);
  var fa=s.foodAreas.map(function(a){return a.id});
  s.menu.forEach(function(c){if(fa.indexOf(c.area)<0)c.area=fa[0];c.items=c.items||[];c.items.forEach(function(i){i.hide=!!i.hide;i.out=!!i.out})});
  if(!s.shifts||typeof s.shifts!=="object"||Array.isArray(s.shifts))s.shifts={};if(!s.shiftsOff||typeof s.shiftsOff!=="object"||Array.isArray(s.shiftsOff))s.shiftsOff={};
  if(!Array.isArray(s.shiftAreas))s.shiftAreas=clone(DEFAULT_SHIFT_AREAS);if(typeof s.shiftPw!=="string"||!s.shiftPw.trim())s.shiftPw=DEFAULT_SHIFT_PW;
  if(!s.concept||!Array.isArray(s.concept.comps)||!s.concept.comps.length)s.concept=deriveConcept(s);
  var cn=s.concept;if(!Array.isArray(cn.halls)||!cn.halls.length)cn.halls=[{id:"Ost",name:"Halle Ost"}];if(!Array.isArray(cn.days)||!cn.days.length)cn.days=[{d:st.day||isoToday(),start:"09:30",end:"19:30"}];
  cn.flast=cn.flast!==false;
  cn.comps.forEach(function(c){c.teams=Math.max(2,+c.teams||8);c.groups=+c.groups===1?1:2;c.rr=+c.rr===2?2:1;if(!MODES.some(function(x){return x[0]===c.mode}))c.mode="semis";c.third=c.third!==false;c.places=c.places!==false;c.dur=Math.max(1,+c.dur||20);
    if(!cn.halls.some(function(h){return h.id===c.hall}))c.hall=cn.halls[0].id;if(!c.code)c.code=String(c.name||"X").charAt(0).toUpperCase()||"X"});
  return s}
/* Turnierkonzept aus einem bestehenden Spielplan ableiten (z. B. für das 43. Novemberturnier) */
function deriveConcept(s){
  var st=s.settings,cats=[],halls=[],days=[];
  s.matches.forEach(function(m){if(m.cat&&cats.indexOf(m.cat)<0)cats.push(m.cat);if(m.pitch&&halls.indexOf(m.pitch)<0)halls.push(m.pitch);var d=m.day||st.day;if(d&&days.indexOf(d)<0)days.push(d)});
  s.teams.forEach(function(t){var c=gCat(t.group);if(c&&cats.indexOf(c)<0)cats.push(c)});
  if(!cats.length)cats=["Damen","Herren"];if(!halls.length)halls=["Ost","West"];days.sort();if(!days.length)days=[st.day||isoToday()];
  var comps=cats.map(function(c,i){
    var ms=s.matches.filter(function(m){return m.cat===c}),hc={};ms.forEach(function(m){if(m.group)hc[m.pitch]=(hc[m.pitch]||0)+1});
    var hall=Object.keys(hc).sort(function(a,b){return hc[b]-hc[a]})[0]||halls[i%halls.length];
    var gs={};s.teams.forEach(function(t){if(gCat(t.group)===c)gs[t.group]=1});
    var ko=ms.filter(function(m){return !m.group});
    var semis=ko.some(function(m){return /Halbfinale/.test(m.round||"")});
    return {id:c,name:c,code:c.charAt(0).toUpperCase(),hall:hall,teams:s.teams.filter(function(t){return gCat(t.group)===c}).length||8,groups:Object.keys(gs).length===1?1:2,rr:1,
      mode:semis?"semis":ko.length?"place":"league",third:!ko.length||ko.some(function(m){return placeBase(m)===3}),places:!ko.length||ko.some(function(m){return placeBase(m)>=5||m.round==="Platzierungsrunde"}),
      dur:+(c==="Herren"?st.durH:st.durD)||20}});
  var dayList=days.map(function(d){var a=null,b=null;s.matches.forEach(function(m){if((m.day||st.day)!==d)return;var t=tmin(m.time);if(t===null)return;var c=comps.find(function(x){return x.id===m.cat});var e=t+(c?c.dur:20);if(a===null||t<a)a=t;if(b===null||e>b)b=e});
    var ss=(st.starts||{})[d]||{};Object.keys(ss).forEach(function(h){var t=tmin(ss[h]);if(t!==null&&(a===null||t<a))a=t});
    return {d:d,start:a===null?"09:30":tfmt(a),end:b===null?"19:30":tfmt(Math.ceil(b/30)*30)}});
  return {halls:halls.map(function(h){return{id:h,name:"Halle "+h}}),comps:comps,days:dayList,flast:true}}

/* ---------- Speicher ---------- */
function lsGet(k){try{return JSON.parse(localStorage.getItem(k)||"null")}catch(e){return null}}
function lsSet(k,v){try{if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function authed(){return !!USER}
function saveResume(){lsSet("nt-resume",{route:route,atab:atab,afilter:afilter,filter:filter,tcat:tcat,t:Date.now()})}

/* ---------- Hilfen ---------- */
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function uid(p){return p+Math.random().toString(36).slice(2,9)}
function eur(n){return Number(n||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"})}
function clone(o){return JSON.parse(JSON.stringify(o))}
function S(){return DRAFT||STATE}
function curLogo(){return (DRAFT&&DRAFT.clubLogo)||(STATE&&STATE.clubLogo)||DEFAULT_LOGO}
function teamById(id){return id?S().teams.find(function(t){return t.id===id}):null}
function matchById(id){return S().matches.find(function(m){return m.id===id})}
function num(v){return v!=null&&v!==""}
function hasScore(m){return num(m.hs)&&num(m.as)}
function isKO(m){return !m.group&&m.round!=="Platzierungsrunde"}
function mday(m){return m.day||S().settings.day||""}
function sortedMatches(){return S().matches.slice().sort(function(a,b){return mday(a).localeCompare(mday(b))||(a.time||"").localeCompare(b.time||"")||String(a.pitch).localeCompare(String(b.pitch))})}
function dur(m){return durOf(S(),m)}
/* ---------- Turnierkonzept: Wettbewerbe, Hallen ---------- */
function CN(){return S().concept}
function comps(){return CN().comps}
function compById(id,st){return ((st||S()).concept.comps||[]).find(function(c){return c.id===id})}
function catName(id){var c=compById(id);return c?c.name:String(id||"")}
/* Wettbewerbe laut Konzept, plus solche, die noch im Spielplan stehen */
function cats(){var out=comps().map(function(c){return c.id});S().matches.forEach(function(m){if(m.cat&&out.indexOf(m.cat)<0)out.push(m.cat)});return out}
function hallName(id,st){var h=((st||S()).concept.halls||[]).find(function(x){return x.id===id});return h?h.name:(id?"Halle "+id:"")}
function gCat(g){g=String(g||"");var i=g.lastIndexOf(" ");return i>0?g.slice(0,i):g}
function gLetter(g){g=String(g||"");return g.slice(g.lastIndexOf(" ")+1)}
function grpLabel(g){return catName(gCat(g))+" · "+shortG(g)}
function ed(){var n=parseInt((S().settings||{}).edition,10);return n>0?n:0}
function tName(){return S().settings.title||"Turnier"}
function fullTitle(){return (ed()?ed()+". ":"")+tName()}
function slug(s){return String(s).toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"turnier"}
/* ---------- Zeitplan: Starts je Tag und Halle, Spielzeit + Wechsel ---------- */
function pause(){var v=+S().settings.pause;return isNaN(v)||v<0?5:v}
function tmin(t){var p=String(t||"").split(":");return p.length<2?null:(+p[0])*60+(+p[1]||0)}
function tfmt(n){n=((Math.round(n)%1440)+1440)%1440;return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0")}
function slotGroups(st){var g={};st.matches.forEach(function(m){var d=m.day||st.settings.day||"",h=m.pitch||"";(g[d+"|"+h]=g[d+"|"+h]||{day:d,hall:h,ms:[]}).ms.push(m)});
  return Object.keys(g).sort().map(function(k){var x=g[k];x.ms.sort(function(a,b){return (tmin(a.time)||0)-(tmin(b.time)||0)||String(a.id).localeCompare(String(b.id),"de",{numeric:true})});return x})}
function startOf(st,day,hall,ms){var s=(st.settings.starts||{})[day];var v=s&&s[hall];if(tmin(v)!==null)return v;var f=ms&&ms[0]&&ms[0].time;return tmin(f)!==null?f:"09:00"}
function durOf(st,m){var c=st.concept&&compById(m.cat,st);return Math.max(1,(c?+c.dur:+(m.cat==="Herren"?st.settings.durH:st.settings.durD))||20)}
/* Momentaufnahme der Zeiten, damit bewusst eingebaute Pausen beim Neuberechnen erhalten bleiben */
function timing(st){var d={};st.matches.forEach(function(m){d[m.cat]=durOf(st,m)});return{pause:st.settings.pause,durs:d}}
function reflow(st,old){old=old||timing(st);var p=+st.settings.pause,op=+old.pause;if(isNaN(p)||p<0)p=5;if(isNaN(op)||op<0)op=5;
  var od=function(m){return old.durs[m.cat]||durOf(st,m)};
  /* Pausen, die im Plan bewusst eingebaut sind (z. B. Mittag, vor Finals), bleiben erhalten */
  slotGroups(st).forEach(function(g){var gaps=g.ms.map(function(m,i){if(!i)return 0;var pr=g.ms[i-1],x=tmin(m.time)-(tmin(pr.time)+od(pr)+op);return x>0?x:0});
    var t=tmin(startOf(st,g.day,g.hall,g.ms));g.ms.forEach(function(m,i){t+=gaps[i];m.time=tfmt(t);t+=durOf(st,m)+p})})}
function matchStart(m){var d=mday(m);if(!d||!m.time)return null;var p=d.split("-"),h=m.time.split(":");return new Date(+p[0],p[1]-1,+p[2],+h[0],+h[1]||0).getTime()}
function finished(m){return hasScore(m)&&!liveInfo(m)}
/* Spieluhr: live ist ein Spiel nur, wenn es im Orga-Bereich angepfiffen wurde.
   clk = {st:"run"|"pause"|"end", t0: Startzeit des laufenden Abschnitts (ms), acc: bereits gelaufene ms} */
function clkElapsed(m){var c=m.clk;if(!c)return 0;return Math.max(0,(+c.acc||0)+(c.st==="run"&&c.t0?Date.now()-c.t0:0))}
function clkMin(m){return m.clk?Math.floor(clkElapsed(m)/60e3)+1:null}
function liveInfo(m){var c=m.clk;if(!c||(c.st!=="run"&&c.st!=="pause"))return null;var e=clkElapsed(m),D=dur(m)*60e3;
  return{min:Math.floor(e/60e3)+1,p:Math.min(1,e/D),paused:c.st==="pause",over:e>=D}}
function minTxt(li){return li.min+". Min."+(li.paused?" · Pause":"")}
/* Tore in Reihenfolge der Spielminute, mit laufendem Zwischenstand */
function goalList(m){var g=(m.goals||[]).map(function(x,i){return{s:x.s,min:x.min,i:i}});
  g.sort(function(a,b){return (a.min==null?-1:a.min)-(b.min==null?-1:b.min)||a.i-b.i});
  var h=0,a=0;g.forEach(function(x){if(x.s==="h")h++;else a++;x.h=h;x.a=a});return g}
/* Torliste an den eingetragenen Spielstand angleichen: neue Tore bekommen die aktuelle Spielminute */
function syncGoals(m){if(!m.clk)return;var g=m.goals=(m.goals||[]).slice(),mn=clkMin(m);
  [["h","hs"],["a","as"]].forEach(function(p){var want=num(m[p[1]])?+m[p[1]]:0,have=g.filter(function(x){return x.s===p[0]}).length;
    for(;have<want;have++)g.push({s:p[0],min:mn});
    for(;have>want;have--){var idx=-1,best=-1;g.forEach(function(x,i){if(x.s===p[0]&&(x.min==null?-1:x.min)>=best){best=x.min==null?-1:x.min;idx=i}});if(idx>=0)g.splice(idx,1)}})}
function liveMatches(){return sortedMatches().filter(function(m){return liveInfo(m)})}
function nextMatch(){return sortedMatches().find(function(m){return !hasScore(m)&&!liveInfo(m)})}
function fmtDay(d,o){if(!d)return"";var p=d.split("-");return new Date(+p[0],p[1]-1,+p[2]).toLocaleDateString("de-DE",o||{weekday:"long",day:"numeric",month:"long"})}
function multiDay(){var s={};S().matches.forEach(function(m){s[mday(m)]=1});return Object.keys(s).length>1}
function hall(m){return hallName(m.pitch)}
function groupsOf(cat){var g=[];S().teams.forEach(function(t){if(t.group&&gCat(t.group)===cat&&g.indexOf(t.group)<0)g.push(t.group)});return g.sort()}
function allGroups(){return [].concat.apply([],cats().map(groupsOf))}
function shortG(g){return groupsOf(gCat(g)).length>1?"Gruppe "+gLetter(g):"Gruppe"}
function initials(n){var w=String(n||"?").replace(/[^\p{L}\p{N} ]/gu,"").trim().split(/\s+/);return ((w[0]||"?")[0]+(w[1]?w[1][0]:(w[0]||"")[1]||"")).toUpperCase()}
function logo(team,size){
  var st=size?' style="--s:'+size+'px"':'';
  if(!team)return '<span class="lg nil"'+st+' aria-hidden="true">?</span>';
  if(team.logo)return '<span class="lg"'+st+'><img src="'+esc(team.logo)+'" alt=""></span>';
  return '<span class="lg ini"'+st+' aria-hidden="true">'+esc(initials(team.name))+'</span>';
}

/* ---------- Wertung ---------- */
function blank(t){return{t:t,sp:0,s:0,u:0,n:0,tf:0,tg:0,p:0}}
function tally(rows,ms){
  ms.forEach(function(x){var h=rows[x.h],a=rows[x.a];if(!h||!a)return;var hs=+x.m.hs,as=+x.m.as;h.sp++;a.sp++;h.tf+=hs;h.tg+=as;a.tf+=as;a.tg+=hs;
    if(hs>as){h.s++;a.n++;h.p+=3}else if(hs<as){a.s++;h.n++;a.p+=3}else{h.u++;a.u++;h.p++;a.p++}});
}
/* Punkte – Tordifferenz – Tore – direkter Vergleich – (extra) – Name */
function rank(list,ms,extra){
  function key(r){return [r.p,r.tf-r.tg,r.tf].join("|")}
  list.sort(function(a,b){return b.p-a.p||(b.tf-b.tg)-(a.tf-a.tg)||b.tf-a.tf});
  var out=[],i=0;
  while(i<list.length){var j=i;while(j<list.length&&key(list[j])===key(list[i]))j++;
    var cl=list.slice(i,j);
    if(cl.length>1){var ids=cl.map(function(r){return r.t.id}),h2h={};ids.forEach(function(id){h2h[id]=0});
      ms.forEach(function(x){if(ids.indexOf(x.h)<0||ids.indexOf(x.a)<0)return;var hs=+x.m.hs,as=+x.m.as;
        if(hs>as)h2h[x.h]+=3;else if(as>hs)h2h[x.a]+=3;else{h2h[x.h]++;h2h[x.a]++}});
      cl.sort(function(a,b){return h2h[b.t.id]-h2h[a.t.id]||(extra?extra(a)-extra(b):0)||a.t.name.localeCompare(b.t.name)})}
    out=out.concat(cl);i=j}
  return out;
}
var _gs={};
function standings(g){
  if(_gs[g])return _gs[g];
  var rows={};S().teams.filter(function(t){return t.group===g}).forEach(function(t){rows[t.id]=blank(t)});
  var ms=S().matches.filter(function(m){return m.group===g&&hasScore(m)}).map(function(m){return{m:m,h:m.home,a:m.away}});
  tally(rows,ms);
  return (_gs[g]=rank(Object.keys(rows).map(function(k){return rows[k]}),ms));
}
function groupDone(g){var ms=S().matches.filter(function(m){return m.group===g});return ms.length>0&&ms.every(finished)}
function winnerSide(m){if(!finished(m))return null;var hs=+m.hs,as=+m.as;if(hs>as)return"home";if(as>hs)return"away";
  if(isKO(m)&&num(m.hp)&&num(m.ap)&&+m.hp!==+m.ap)return +m.hp>+m.ap?"home":"away";return null}
var _rs={};
function resolve(m,side){
  var k=m.id+side;if(k in _rs)return _rs[k];_rs[k]=null;
  var t=teamById(m[side]);
  if(!t){var sp=m[side==="home"?"hsrc":"asrc"];
    if(sp&&sp.k==="g"){if(groupDone(sp.g)){var r=standings(sp.g)[sp.p-1];t=r?r.t:null}}
    else if(sp&&(sp.k==="w"||sp.k==="l")){var tm=matchById(sp.m);if(tm){var ws=winnerSide(tm);
      if(ws){var wn=resolve(tm,ws),ls=resolve(tm,ws==="home"?"away":"home");t=sp.k==="w"?wn:ls}}}}
  return (_rs[k]=t||null);
}
function clearCache(){_gs={};_rs={};_pr={}}
function sideName(m,side){var t=resolve(m,side);return t?t.name:(m[side==="home"?"hn":"an"]||"offen")}
function involves(m,id){var h=resolve(m,"home"),a=resolve(m,"away");return (h&&h.id===id)||(a&&a.id===id)}
var _pr={};
function prTable(cat){
  if(_pr[cat])return _pr[cat];
  var ms=S().matches.filter(function(m){return m.cat===cat&&m.round==="Platzierungsrunde"});
  var slots=[];ms.forEach(function(m){[m.hsrc,m.asrc].forEach(function(sp){if(sp&&sp.k==="g"&&!slots.some(function(s){return s.g===sp.g&&s.p===sp.p}))slots.push(sp)})});
  slots.sort(function(a,b){return a.p-b.p||a.g.localeCompare(b.g)});
  var rows={},seed={},list=[],missing=[];
  slots.forEach(function(sp){var t=groupDone(sp.g)?(standings(sp.g)[sp.p-1]||{}).t:null;
    if(t){rows[t.id]=blank(t);seed[t.id]=sp.p;list.push(rows[t.id])}else missing.push(sp)});
  var played=ms.filter(function(m){return hasScore(m)}).map(function(m){var h=resolve(m,"home"),a=resolve(m,"away");return{m:m,h:h&&h.id,a:a&&a.id}});
  tally(rows,played);
  var ranked=rank(list,played,function(r){return seed[r.t.id]||9});
  return (_pr[cat]={rows:ranked,missing:missing,done:ms.length>0&&ms.every(hasScore)&&!missing.length,count:ms.length,played:ms.filter(hasScore).length,n:slots.length});
}
function placeBase(m){if(m.round==="Finale")return 1;var x=/^Spiel um Platz (\d+)$/.exec(m.round||"");return x?+x[1]:0}
function finalPlaces(cat){
  /* Finale = Plätze 1/2, "Spiel um Platz N" = Plätze N/N+1, danach ggf. Platzierungsrunde */
  var all=S().matches.filter(function(m){return m.cat===cat});
  var ko=all.filter(function(m){return placeBase(m)>0}).sort(function(a,b){return placeBase(a)-placeBase(b)});
  var out=[];
  ko.forEach(function(m){var lbl=m.round,w=winnerSide(m),b=placeBase(m);
    [true,false].forEach(function(win,i){
      if(!w)out.push({rk:b+i,l:(win?"Sieger ":"Verlierer ")+lbl});
      else out.push({rk:b+i,t:resolve(m,win?w:(w==="home"?"away":"home"))})})});
  /* Halbfinale ohne Spiel um Platz 3: beide Verlierer teilen sich Platz 3 */
  var sf=all.filter(function(m){return /Halbfinale/.test(m.round||"")});
  if(sf.length&&!ko.some(function(m){return placeBase(m)===3}))sf.forEach(function(m){var w=winnerSide(m);out.push(w?{rk:3,t:resolve(m,w==="home"?"away":"home")}:{rk:3,l:"Verlierer "+m.round})});
  var next=out.length+1,pr=prTable(cat);
  for(var i=0;i<pr.n;i++)out.push(pr.done&&pr.rows[i]?{rk:next+i,t:pr.rows[i].t}:{rk:next+i,l:(i+1)+". der Platzierungsrunde"});
  next+=pr.n;
  /* Gruppenplätze ohne Platzierungsspiel: Platz ergibt sich aus der Gruppentabelle */
  var cov={};all.forEach(function(m){if(m.group)return;[m.hsrc,m.asrc].forEach(function(sp){if(sp&&sp.k==="g")cov[sp.g+"|"+sp.p]=1})});
  var gs=groupsOf(cat),mx=0;gs.forEach(function(g){mx=Math.max(mx,S().teams.filter(function(t){return t.group===g}).length)});
  for(var p=1;p<=mx;p++){var ent=[];gs.forEach(function(g){var n=S().teams.filter(function(t){return t.group===g}).length;if(p>n||cov[g+"|"+p])return;
      var r=groupDone(g)?standings(g)[p-1]:null;ent.push(r?{t:r.t}:{l:p+". "+shortG(g)})});
    ent.forEach(function(e){e.rk=next;out.push(e)});next+=ent.length}
  return out;
}

/* ---------- Symbole & Navigation ---------- */
var ICON={
 home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
 plan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7"/></svg>',
 teams:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
 table:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V10h5v11M9 21V4h6v17M15 21v-8h5v8M2 21h20"/></svg>',
 back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
 food:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v8a3 3 0 0 0 6 0V2M9 2v20M17 2c-2 2-3 5-3 8h4v12"/></svg>'
};
var NAV=[["home","Start"],["plan","Spielplan"],["teams","Teams"],["table","Tabelle"]];
/* Speisen & Getränke erscheinen nur, wenn der Bereich freigeschaltet UND aktiv ist */
function foodVisible(){var s=S().settings;return !!(s.foodOn&&s.foodLive)}
function navItems(){return foodVisible()?NAV.concat([["food","Essen"]]):NAV}
function nav(){var it=navItems();return '<nav class="bn" aria-label="Hauptnavigation"><div class="wrap" style="grid-template-columns:repeat('+it.length+',1fr)">'+it.map(function(p){
  return '<button data-go="'+p[0]+'"'+(route===p[0]?' aria-current="page"':'')+'>'+ICON[p[0]]+'<span>'+p[1]+'</span></button>'}).join("")+'</div></nav>'}
function pageHead(t,back){return '<div class="ph"><div class="wrap"><img src="'+curLogo()+'" alt="Zur Startseite" role="button" tabindex="0" data-go="home"><h1>'+t+'</h1>'+(back?'<button class="close-btn phback" data-go="home" aria-label="Zurück zur Startseite">'+ICON.back+'</button>':'')+'</div></div>'}

/* ---------- Ansichten ---------- */
/* Hallenhockey-Spielfeld als Hintergrund: Schusskreis, 7-m-Punkt, Bande */
var COURT='<svg class="court" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" stroke-width="2"><rect x="10" y="20" width="380" height="560" rx="6"/><path d="M80 20v8a120 120 0 0 0 240 0v-8"/><circle cx="200" cy="150" r="3" fill="currentColor"/><path d="M170 20v-8h60v8"/><path d="M10 300h380" opacity=".6"/><circle cx="200" cy="300" r="60" opacity=".5"/></svg>';
function hero(){
  var st=S().settings,meta=[st.date,st.place].filter(Boolean).map(esc).join(" · ");
  var halls=comps().map(function(c){return '<span>'+esc(c.name)+' · '+esc(hallName(c.hall))+'</span>'}).join("");
  return '<header class="hero">'+COURT+'<div class="wrap"><div class="hero-top"><img src="'+curLogo()+'" alt="Logo '+esc(st.club)+'"><div class="club">'+esc(st.club)+(st.dept?'<br>'+esc(st.dept):'')+'</div><button class="info-btn" data-go="info" aria-label="Infos zum Turnier">i</button></div>'+
   (ed()?'<div class="hero-num"><span class="n" aria-hidden="true">'+ed()+'</span><span class="lbl">Auflage<br>des Turniers</span></div>':'')+'<h1'+(ed()?'':' class="solo"')+'><span class="sr">'+(ed()?ed()+'. ':'')+'</span>'+esc(tName())+'</h1>'+(meta?'<p class="meta">'+meta+'</p>':'')+
   (halls?'<div class="halls">'+halls+'</div>':'')+'</div></header>';
}
function tile(k,t,body,cls){return '<button class="tile '+cls+'" data-go="'+k+'"><div class="t-head"><h2>'+t+'</h2>'+ICON[k]+'</div><div class="t-body">'+body+'</div></button>'}
function vHome(){
  var nm=nextMatch(),lv=liveMatches(),items=[].concat.apply([],S().menu.map(function(c){return c.items||[]})).filter(function(i){return !i.hide});
  var wd=function(m){return multiDay()?fmtDay(mday(m),{weekday:"long"})+" ":""};
  var lbl=function(m){return catName(m.cat)+(m.group?" "+shortG(m.group):" · "+m.round)};
  var plan=lv.length?'<span class="lvtag"><i></i>Live'+(lv.length>1?", "+lv.length+" Spiele":"")+'</span><span>'+liveInfo(lv[0]).min+'. Minute, '+esc(hall(lv[0]))+', '+esc(lbl(lv[0]))+'</span><strong>'+esc(sideName(lv[0],"home"))+'<span class="vs">'+(hasScore(lv[0])?(+lv[0].hs)+':'+(+lv[0].as):'gegen')+'</span>'+esc(sideName(lv[0],"away"))+'</strong>'
    :nm?'<span>Als Nächstes '+esc(wd(nm))+'um '+esc(nm.time)+' Uhr, '+esc(hall(nm))+', '+esc(lbl(nm))+'</span><strong>'+esc(sideName(nm,"home"))+'<span class="vs">gegen</span>'+esc(sideName(nm,"away"))+'</strong>'
    :(S().matches.length?'<strong>Alle Spiele sind gespielt</strong>':'<strong>Der Spielplan folgt</strong>');
  var champs=cats().map(function(c){var w=finalPlaces(c).filter(function(x){return x.rk===1});return w.length===1&&w[0].t?catName(c)+": "+w[0].t.name:""}).filter(Boolean);
  var leaders=allGroups().map(function(g){var s=standings(g);return s.length&&s[0].sp?grpLabel(g)+": "+s[0].t.name:""}).filter(Boolean);
  var gn=allGroups().length,cn=comps().map(function(c){return c.name});
  var tbl=champs.length?'<strong>Turniersieg</strong><span>'+champs.map(esc).join("<br>")+'</span>'
    :leaders.length?'<strong>'+esc(leaders[0])+'</strong><span>'+leaders.slice(1).map(esc).join("<br>")+'</span>':'<strong>Noch keine Ergebnisse</strong><span>'+gn+(gn===1?' Gruppe':' Gruppen')+(cn.length?', '+esc(cn.length>1?cn.slice(0,-1).join(", ")+" und "+cn[cn.length-1]:cn[0]):'')+'</span>';
  var ch=items.filter(function(i){return !i.out}).sort(function(a,b){return a.price-b.price})[0];
  var food=items.length?'<strong>'+items.length+' Angebote</strong><span>'+(ch?"ab "+eur(ch.price):"")+'</span>':'<strong>Karte folgt</strong><span>Speisen und Getränke</span>';
  var tm=S().teams;
  var per=cats().map(function(c){var n=tm.filter(function(t){return gCat(t.group)===c}).length;return n?n+" "+catName(c):""}).filter(Boolean).join(", ");
  var teams='<div class="lgs">'+tm.slice(0,12).map(function(t){return logo(t)}).join("")+'</div><strong>'+tm.length+' Teams</strong><span>'+esc(per)+'</span>';
  return hero()+'<main><div class="wrap"><div class="tiles">'+tile("plan","Spielplan",plan,"big")+tile("table","Tabelle",tbl,"")+tile("teams","Teams",teams,"")+(foodVisible()?tile("food","Essen & Getränke",food,"wide"):"")+
   '</div><p class="foot">'+esc(fullTitle())+(S().settings.club?' · '+esc(S().settings.club):'')+'<br><button data-go="admin">Orga-Bereich</button><br><button data-go="shifts">Schichtpläne</button></p></div></main>'+nav();
}
function midLabel(m){return '<b>'+esc(catName(m.cat))+' · '+esc(m.id)+'</b>'+esc(m.group?shortG(m.group):m.round)}
function gameHTML(m,nx){
  var sc=hasScore(m),hs=+m.hs,as=+m.as,t1=resolve(m,"home"),t2=resolve(m,"away"),lv=liveInfo(m),w=winnerSide(m);
  var fin=sc&&!lv;var so=sc&&hs===as&&isKO(m)&&num(m.hp)&&num(m.ap)?'<div class="so">n. 7m '+(+m.hp)+':'+(+m.ap)+'</div>':'';
  var mid='<div class="mid">'+(lv?'<span class="pill lv"><i></i>LIVE</span>':nx?'<span class="pill">Als Nächstes</span>':'')+'<div class="grp">'+midLabel(m)+'</div>'+
    (lv?(sc?'<div class="score">'+hs+':'+as+'</div>'+so:'')+'<div class="min'+(lv.paused?' paused':'')+'" data-clk="'+esc(m.id)+'">'+minTxt(lv)+'</div><div class="prog" aria-hidden="true"><b style="--p:'+(lv.p*100).toFixed(1)+'%"></b></div><div class="small">'+esc(hall(m))+'</div>'
    :sc?'<div class="score">'+hs+':'+as+'</div>'+so+'<div class="small">'+esc(m.time)+' Uhr, '+esc(hall(m))+'</div>'
       :'<div class="vs">vs.</div><div class="clock">'+esc(m.time)+'</div><div class="small">'+esc(hall(m))+'</div>')+'</div>';
  function side(t,s,won){return '<div class="side">'+logo(t,56)+'<span class="nm'+(t?'':' ph-t')+(won?' won':'')+'">'+esc(s)+'</span></div>'}
  return '<div class="game'+(lv?' live':nx?' next':'')+'">'+side(t1,sideName(m,"home"),fin&&t1&&w==="home")+mid+side(t2,sideName(m,"away"),fin&&t2&&w==="away")+goalsHTML(m,t1,t2)+'</div>';
}
/* Zeitstrahl der Tore: Heimtore links der Mittellinie, Gasttore rechts */
function goalsHTML(m,t1,t2){var g=goalList(m);if(!g.length)return"";
  return '<ol class="tl" aria-label="Torfolge">'+g.map(function(x){var who=x.s==="h"?(t1?t1.name:sideName(m,"home")):(t2?t2.name:sideName(m,"away"));
    var t='<span class="tl-t">Tor'+(x.min!=null?' · '+x.min+'. Min.':'')+'</span>',sc='<b>'+x.h+':'+x.a+'</b>';
    return '<li class="tl-'+x.s+'" aria-label="'+esc(x.h+':'+x.a+(x.min!=null?' in der '+x.min+'. Minute':'')+', Tor für '+who)+'"><span class="tl-c">'+(x.s==="h"?t+sc:sc+t)+'</span></li>'}).join("")+'</ol>'}
function vPlan(){
  var used={};S().matches.forEach(function(m){used[m.pitch]=1});var hs=CN().halls.filter(function(h){return used[h.id]});
  var opts=[["Alle","Alle"]].concat(cats().length>1?cats().map(function(c){return["c:"+c,catName(c)]}):[],hs.length>1?hs.map(function(h){return["h:"+h.id,h.name]}):[],S().matches.some(function(m){return !m.group})?[["Finalrunde","Finalrunde"]]:[]);
  var teamF=filter.indexOf("team:")===0?teamById(filter.slice(5)):null;
  if(!teamF&&!opts.some(function(o){return o[0]===filter}))filter="Alle";
  var nm=nextMatch();
  var ms=sortedMatches().filter(function(m){
    if(teamF)return involves(m,teamF.id);
    if(filter==="Alle")return true;if(filter==="Finalrunde")return !m.group;
    if(filter.indexOf("h:")===0)return m.pitch===filter.slice(2);return m.cat===filter.slice(2)});
  var chips=(teamF?'<button class="chip" data-filter="Alle" aria-pressed="true">'+esc(teamF.name)+' ✕</button>':'')+opts.map(function(o){return '<button class="chip" data-filter="'+esc(o[0])+'" aria-pressed="'+(!teamF&&o[0]===filter)+'">'+esc(o[1])+'</button>'}).join("");
  var md=multiDay(),cur=null;var body=ms.length?'<div class="games">'+ms.map(function(m){var h="";if(md&&mday(m)!==cur){cur=mday(m);h='<h2 class="dayh">'+esc(fmtDay(cur))+'</h2>'}return h+gameHTML(m,nm&&nm.id===m.id)}).join("")+'</div>':'<div class="empty">In dieser Auswahl gibt es keine Spiele.</div>';
  return pageHead("Spielplan")+'<main><div class="wrap"><div class="chips" role="group" aria-label="Filter">'+chips+'</div>'+body+'</div></main>'+nav();
}
function vTeams(){
  var tm=S().teams;
  function grid(list){return '<div class="tgrid">'+list.map(function(t){return '<button class="tcard" data-team="'+t.id+'">'+logo(t,84)+'<span class="nm">'+esc(t.name)+'</span></button>'}).join("")+'</div>'}
  var body=tm.length?allGroups().map(function(g){return '<h2 class="sec">'+esc(grpLabel(g))+'</h2>'+grid(tm.filter(function(t){return t.group===g}))}).join(""):'<div class="empty">Die Teams werden bald bekannt gegeben.</div>';
  return pageHead("Teams")+'<main><div class="wrap"><p class="hint" style="margin-top:0">Tippe auf ein Team, um seine Spiele zu sehen.</p>'+body+'</div></main>'+nav();
}
function tableHTML(rows,startAt,missing){
  return '<div class="tbl-wrap"><table><thead><tr><th>#</th><th class="team">Team</th><th>Sp</th><th class="sun">S</th><th class="sun">U</th><th class="sun">N</th><th>Tore</th><th>Pkt</th></tr></thead><tbody>'+
    rows.map(function(r,i){return '<tr class="'+(i===0&&r.sp?"lead":"")+'"><td class="pos">'+(i+startAt)+'</td><td class="team"><span class="tc">'+logo(r.t,28)+esc(r.t.name)+'</span></td><td>'+r.sp+'</td><td class="sun">'+r.s+'</td><td class="sun">'+r.u+'</td><td class="sun">'+r.n+'</td><td>'+r.tf+':'+r.tg+'</td><td class="pts">'+r.p+'</td></tr>'}).join("")+
    (missing||[]).map(function(sp,i){return '<tr><td class="pos">'+(rows.length+i+startAt)+'</td><td class="team"><span class="tc">'+logo(null,28)+'<span class="ph-t">'+esc(sp.p+". "+shortG(sp.g))+'</span></span></td><td>–</td><td class="sun">–</td><td class="sun">–</td><td class="sun">–</td><td>–</td><td class="pts">–</td></tr>'}).join("")+
    '</tbody></table></div>';
}
function groupNote(cat){var ms=S().matches.filter(function(m){return m.cat===cat}),one=groupsOf(cat).length<2;
  if(ms.some(function(m){return /Halbfinale/.test(m.round||"")}))return one?"Die ersten vier spielen im Halbfinale.":"Platz 1 und 2 spielen im Halbfinale.";
  if(ms.some(function(m){return !m.group}))return one?"Danach Platzierungsspiele nach Tabelle: 1.–2. im Finale, 3.–4. um Platz 3 usw.":"Danach spielen die Gruppenplätze direkt gegeneinander: 1.–1. im Finale, 2.–2. um Platz 3 usw.";
  return "Die Tabelle entscheidet über die Endplatzierung."}
function vTable(){
  if(cats().indexOf(tcat)<0)tcat=cats()[0]||"";
  var c=tcat,gs=groupsOf(c),pr=prTable(c),fp=finalPlaces(c);
  var chips=cats().length>1?'<div class="chips" role="group" aria-label="Wettbewerb">'+cats().map(function(x){return '<button class="chip" data-tcat="'+esc(x)+'" aria-pressed="'+(x===c)+'">'+esc(catName(x))+'</button>'}).join("")+'</div>':'';
  var body=gs.map(function(g){var s=standings(g),ms=S().matches.filter(function(m){return m.group===g});
    return '<h2 class="sec">'+esc(shortG(g))+'</h2>'+tableHTML(s,1)+'<p class="sub">'+(groupDone(g)?'Gruppe abgeschlossen.':ms.filter(hasScore).length+' von '+ms.length+' Spielen gespielt.')+' '+groupNote(c)+'</p>'}).join("");
  if(pr.n)body+='<h2 class="sec">Platzierungsrunde · Plätze 5 bis '+(4+pr.n)+'</h2>'+tableHTML(pr.rows,5,pr.missing)+'<p class="sub">Die Gruppendritten bis -letzten spielen je zwei Spiele gegen Teams der anderen Gruppe. '+pr.played+' von '+pr.count+' Spielen gespielt. Bei Gleichstand zählt zuletzt die bessere Gruppenplatzierung.</p>';
  body+='<h2 class="sec">Endplatzierung</h2><div class="podium">'+fp.map(function(x){return '<div class="place p'+x.rk+'"><span class="rk">'+x.rk+'</span>'+logo(x.t||null,30)+(x.t?'<b>'+esc(x.t.name)+'</b>':'<b class="ph-t">'+esc(x.l)+'</b>')+'</div>'}).join("")+'</div>';
  return pageHead("Tabelle")+'<main><div class="wrap">'+chips+body+'<p class="hint">Sieg 3 Punkte, Unentschieden 1 Punkt. Bei Gleichstand zählen Tordifferenz, erzielte Tore und der direkte Vergleich. '+(S().matches.some(function(m){return m.cat===c&&isKO(m)})?'Halbfinale, Platzierungsspiele und Finale werden bei Unentschieden per 7-m-Schießen entschieden.':'')+'</p></div></main>'+nav();
}
function catHTML(c){var its=(c.items||[]).filter(function(i){return !i.hide});
  return '<section class="cat"><h2 class="sec">'+esc(c.name)+'</h2>'+(its.length?its.map(function(i){
    return '<div class="item'+(i.out?" out":"")+'"><span class="nm">'+esc(i.name)+'</span><span class="pr">'+eur(i.price)+'</span>'+((i.note||i.out)?'<span class="nt">'+esc(i.note)+(i.out?(i.note?" ":"")+'<span class="soldout">ausverkauft</span>':'')+'</span>':'')+'</div>'}).join(""):'<p class="hint">Noch keine Einträge.</p>')+'</section>'}
function vFood(){
  var body=S().foodAreas.map(function(a){var cs=S().menu.filter(function(c){return c.area===a.id&&c.items.some(function(i){return !i.hide})});
    return '<div class="area"><h2>'+esc(a.name)+'</h2>'+(a.text?'<p>'+esc(a.text)+'</p>':'')+'</div>'+(cs.length?cs.map(catHTML).join(""):'<div class="empty" style="margin-bottom:26px">Die Karte folgt.</div>')}).join("");
  return pageHead("Essen & Getränke")+'<main><div class="wrap">'+body+'</div></main>'+nav();
}

function vInfo(){
  var body=S().info.length?S().info.map(function(x){return '<section class="isec"><h2>'+esc(x.title)+'</h2><p>'+esc(x.text)+'</p></section>'}).join(""):'<div class="empty">Hier stehen bald alle Infos zum Turnier.</div>';
  return '<div class="ph"><div class="wrap"><img src="'+curLogo()+'" alt="Zur Startseite" role="button" tabindex="0" data-go="home"><h1>Infos</h1><button class="close-btn" data-go="home" aria-label="Infos schließen">✕</button></div></div>'+
   '<main><div class="wrap">'+body+'<button class="btn blue" data-go="home" style="width:100%;margin-top:8px">Zurück zur Startseite</button></div></main>'+nav();
}

/* ---------- Schichtpläne ---------- */
function hh(h){return String(h).padStart(2,"0")+":00"}
function hm(t){t=((t%1440)+1440)%1440;return String(Math.floor(t/60)).padStart(2,"0")+":"+String(t%60).padStart(2,"0")}
/* Minuten-Versatz der Schichten: Schichten beginnen mit dem ersten Anpfiff des Tages (z. B. 09:30) */
function shOff(day){var st=S(),a=null;st.matches.forEach(function(m){if(mday(m)!==day)return;var t=tmin(m.time);if(t!==null&&(a===null||t<a))a=t});return a===null?0:a%60}
function shStart(day,h){return h*60+shOff(day)}
function shLbl(day,h){var t=shStart(day,h);return hm(t)+' – '+hm(t+60)}
function isoToday(){var n=new Date();return n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0")+"-"+String(n.getDate()).padStart(2,"0")}
function shiftDays(){var d={};S().matches.forEach(function(m){if(mday(m))d[mday(m)]=1});return Object.keys(d).sort()}
function curShDay(){var ds=shiftDays();if(ds.indexOf(shDay)<0)shDay=ds.indexOf(isoToday())>=0?isoToday():(ds[0]||"");return shDay}
/* Stundenblöcke ab dem ersten Anpfiff bis zum letzten Abpfiff des Tages, beide Hallen.
   Schlüssel bleibt die Stunde des Blockbeginns (09:30–10:30 = Stunde 9), damit eingetragene Namen erhalten bleiben. */
function shiftSlots(day){
  var st=S(),a=null,b=null;st.matches.forEach(function(m){if(mday(m)!==day)return;var t=tmin(m.time);if(t===null)return;var e=t+durOf(st,m);
    if(a===null||t<a)a=t;if(b===null||e>b)b=e});
  if(a===null)return [];var out=[];for(var t=a;t<b;t+=60)out.push(Math.floor(t/60));return out}
function dayChips(cur){return '<div class="chips" role="group" aria-label="Tag">'+shiftDays().map(function(d){return '<button class="chip" data-shday="'+esc(d)+'" aria-pressed="'+(d===cur)+'">'+esc(fmtDay(d,{weekday:"long"}))+'</button>'}).join("")+'</div>'}
function shiftKey(day,h,area,i){return day+"-"+String(h).padStart(2,"0")+"|"+area+"|"+i}
function areaKey(day,h,area){return day+"-"+String(h).padStart(2,"0")+"|"+area}
function areaOff(st,day,h,area){return !!(st.shiftsOff||{})[areaKey(day,h,area)]}
function shiftNames(st,day,h,a){var ns=[];for(var i=0;i<a.n;i++){var v=((st.shifts||{})[shiftKey(day,h,a.id,i)]||"").trim();if(v)ns.push(v)}return ns}
function shiftResults(q){
  var st=S(),out=[];q=q.trim().toLowerCase();if(!q)return "";
  shiftDays().forEach(function(day){shiftSlots(day).forEach(function(h){st.shiftAreas.forEach(function(a){
    if(areaOff(st,day,h,a.id))return;var ns=shiftNames(st,day,h,a),me=ns.filter(function(n){return n.toLowerCase().indexOf(q)>=0});
    if(!me.length)return;var mates=ns.filter(function(n){return me.indexOf(n)<0});
    out.push('<div class="shres"><span class="shrt">'+esc(fmtDay(day,{weekday:"short"}))+' '+shLbl(day,h)+'</span><b>'+esc(a.name)+'</b><span class="shrm">'+esc(me.join(", "))+(mates.length?' · mit '+esc(mates.join(", ")):'')+'</span></div>')})})});
  return out.length?'<p class="hint" style="margin:0 0 8px"><b>'+out.length+' Schicht'+(out.length===1?'':'en')+'</b> für „'+esc(q)+'“ an allen Tagen</p><div class="shrlist">'+out.join("")+'</div>':'<p class="hint">Keine Schicht für „'+esc(q)+'“ gefunden.</p>'}
function shiftsOk(){return lsGet("nt-shifts")===STATE.shiftPw}
function vShifts(){
  if(!shiftsOk())return pageHead("Schichtpläne",true)+'<main><div class="wrap"><form id="shf" class="card shlock"><h2 class="sec" style="margin-top:0">Geschützter Bereich</h2><p class="hint">Bitte das Passwort für die Schichtpläne eingeben.</p>'+
    '<label class="f" for="shpw">Passwort</label><input class="in" id="shpw" type="password" autocomplete="off" required>'+
    '<button class="btn blue" type="submit" style="width:100%;margin-top:14px">Öffnen</button><div class="err" id="sherr" role="alert"></div></form></div></main>'+nav();
  var st=S(),day=curShDay(),slots=shiftSlots(day),now=new Date(),isToday=day===isoToday();
  var cards=slots.map(function(h){
    var nm=now.getHours()*60+now.getMinutes(),s0=shStart(day,h),isNow=isToday&&nm>=s0&&nm<s0+60;
    var rows=st.shiftAreas.filter(function(a){return !areaOff(st,day,h,a.id)}).map(function(a){var ns=shiftNames(st,day,h,a);
      return '<div class="shrow"><span class="sha">'+esc(a.name)+'</span><span class="shn2'+(ns.length<a.n?' open':'')+'">'+(ns.length?ns.map(esc).join(", "):'')+(ns.length<a.n?(ns.length?' · ':'')+(a.n-ns.length)+' offen':'')+'</span></div>'}).join("");
    return '<section class="shc'+(isNow?' now':'')+'"><h3>'+shLbl(day,h)+' Uhr'+(isNow?'<span class="pill lv"><i></i>Jetzt</span>':'')+'</h3>'+(rows||'<p class="hint" style="margin:4px 0 0">Keine Schicht in dieser Stunde.</p>')+'</section>'}).join("");
  return pageHead("Schichtpläne",true)+'<main><div class="wrap">'+
    '<label class="f" for="shq" style="margin-top:0">Meine Schichten</label><input class="in" id="shq" type="search" value="'+esc(shQ)+'" placeholder="Deinen Namen eingeben …" aria-label="Eigenen Namen suchen" style="margin:0 0 12px">'+
    '<div id="shres">'+shiftResults(shQ)+'</div>'+
    '<div id="shall"'+(shQ.trim()?' style="display:none"':'')+'>'+dayChips(day)+(slots.length?'<div class="shlist">'+cards+'</div>':'<div class="empty">Noch keine Schichten.</div>')+'</div>'+
    '<p style="margin-top:22px;text-align:center"><button class="btn ghost sm" data-act="shLock">Bereich wieder sperren</button></p></div></main>'+nav()}

/* ---------- Orga ---------- */
function vLogin(){
  return '<main><div class="login"><img src="'+curLogo()+'" alt=""><h1>Orga-Bereich</h1><p>Anmelden, um das '+esc(tName())+' zu pflegen.</p>'+
  '<form id="lf" autocomplete="on"><label class="f" for="lu">E-Mail</label><input class="in" id="lu" type="email" autocomplete="username" autocapitalize="none" required>'+
  '<label class="f" for="lp">Passwort</label><input class="in" id="lp" type="password" autocomplete="current-password" required>'+
  '<button class="btn blue" style="width:100%;margin-top:18px" type="submit">Anmelden</button><div class="err" id="lerr" role="alert"></div></form>'+
  '<p style="margin-top:18px"><button class="btn ghost sm" data-go="home">Zur Startseite</button></p></div></main>';
}
var ATABS=[["plan","Ergebnisse"],["concept","Turnierkonzept"],["teams","Teams"],["info","Infos"],["food","Essen & Getränke"],["shifts","Schichten"],["general","Allgemein"]];
function opt(v,l,sel){return '<option value="'+esc(v)+'"'+(v===sel?" selected":"")+'>'+esc(l)+'</option>'}
function armBtn(act,id,label,armedLabel,cls){var on=armed===act+":"+(id||"");return '<button class="btn '+(cls||"icon sm")+(on?" armed":"")+'" data-act="'+act+'"'+(id?' data-id="'+id+'"':'')+'>'+(on?armedLabel:label)+'</button>'}
function aTeams(D){
  return '<p class="hint">Namen hier ändern, Spielplan und Tabellen übernehmen sie automatisch. Logos als PNG oder JPG, sie werden einheitlich zugeschnitten. Wie viele Teams in welchen Gruppen spielen, stellst du unter „Turnierkonzept“ ein.</p><div class="rows">'+
   allGroups().map(function(g){return '<h2 class="sec">'+esc(grpLabel(g))+'</h2>'+D.teams.filter(function(t){return t.group===g}).map(function(t){return '<div class="card"><div class="row"><input class="in grow" id="tn-'+t.id+'" data-k="team.name" data-id="'+t.id+'" value="'+esc(t.name)+'" aria-label="Teamname"></div>'+
    '<div class="upl" style="margin-top:8px">'+logo(t,44)+'<label class="btn ghost sm">'+(t.logo?"Logo ändern":"Logo hochladen")+'<input type="file" accept="image/png,image/jpeg" data-logo="'+t.id+'"></label>'+(t.logo?'<button class="btn icon sm" data-act="delLogo" data-id="'+t.id+'">Logo entfernen</button>':'')+'</div></div>'}).join("")}).join("")+'</div>';
}
function aPlan(D){
  var ds=shiftDays();
  var fs=[["Offen","Offen"],["Alle","Alle"]].concat(ds.length>1?ds.map(function(d){return["d:"+d,fmtDay(d,{weekday:"long"})]}):[],cats().length>1?cats().map(function(c){return["c:"+c,catName(c)]}):[]);
  if(!fs.some(function(f){return f[0]===afilter}))afilter="Offen";
  var chips='<div class="chips" role="group" aria-label="Spiele filtern">'+fs.map(function(f){return '<button class="chip" data-afilter="'+esc(f[0])+'" aria-pressed="'+(f[0]===afilter)+'">'+esc(f[1])+'</button>'}).join("")+'</div>';
  var ms=sortedMatches().filter(function(m){
    if(afilter==="Offen")return !finished(m);if(afilter.indexOf("d:")===0)return mday(m)===afilter.slice(2);
    if(afilter.indexOf("c:")===0)return m.cat===afilter.slice(2);return true});
  function teamSel(m,side){var auto=m[side==="home"?"hsrc":"asrc"],cur=m[side]||"",r=resolve(m,side);
    var o=(auto?opt("","Automatisch: "+(r?r.name:m[side==="home"?"hn":"an"]),cur):"")+D.teams.filter(function(t){return gCat(t.group)===m.cat}).map(function(t){return opt(t.id,t.name,cur)}).join("");
    return '<select class="in" id="'+side+'-'+m.id+'" data-k="m.'+side+'" data-id="'+m.id+'" aria-label="'+(side==="home"?"Team 1":"Team 2")+'">'+o+'</select>'}
  return '<p class="hint">Mit „Anpfiff“ startest du ein Spiel: Es erscheint auf der Turnierseite als LIVE mit Spielminute. „Pause“ hält die Uhr an (z. B. Zeitstrafe, Verletzung), „Weiter“ lässt sie weiterlaufen, „Abpfiff“ beendet das Spiel. Tore während des Spiels mit „+ Tor“ eintragen (sofort online) oder den Stand eintippen und „Speichern“ – jedes neue Tor bekommt automatisch die aktuelle Spielminute. Ergebnisse ohne Anpfiff nachtragen geht weiterhin wie bisher. „Leeren“ entfernt ein Ergebnis wieder. Leere Felder heißen: noch nicht gespielt. Halbfinals und Platzierungsspiele füllen sich automatisch, sobald die Gruppen fertig sind.</p>'+chips+
   (ms.length?'<div class="rows">'+ms.map(function(m){var sc=hasScore(m),ko=isKO(m),li=liveInfo(m);
    return '<div class="card'+(sc&&!li?" done":"")+(li?" rlive":"")+'"><div class="mhead"><span class="code">'+esc(m.id)+'</span>'+(li?'<span class="pill lv"><i></i>LIVE · <span data-clk="'+esc(m.id)+'">'+minTxt(li)+'</span></span>':'')+'<b>'+esc(fmtDay(mday(m),{weekday:"short"}))+' '+esc(m.time)+'</b><span>'+esc(hall(m))+'</span><span>'+esc(catName(m.cat))+' · '+esc(m.group?shortG(m.group):m.round)+'</span></div>'+
     '<div class="mrow">'+(m.hsrc?teamSel(m,"home"):'<span class="tn">'+esc(sideName(m,"home"))+'</span>')+'<input class="in score-in" id="hs-'+m.id+'" inputmode="numeric" data-k="m.hs" data-id="'+m.id+'" value="'+(num(m.hs)?m.hs:"")+'" aria-label="Tore Team 1">'+
     '<span class="vsl">gegen</span>'+(m.asrc?teamSel(m,"away"):'<span class="tn">'+esc(sideName(m,"away"))+'</span>')+'<input class="in score-in" id="as-'+m.id+'" inputmode="numeric" data-k="m.as" data-id="'+m.id+'" value="'+(num(m.as)?m.as:"")+'" aria-label="Tore Team 2"></div>'+
     (ko?'<div class="so-row"><span>Bei Unentschieden: 7-m-Schießen</span><input class="in score-in" id="hp-'+m.id+'" inputmode="numeric" data-k="m.hp" data-id="'+m.id+'" value="'+(num(m.hp)?m.hp:"")+'" aria-label="7 m Team 1"><input class="in score-in" id="ap-'+m.id+'" inputmode="numeric" data-k="m.ap" data-id="'+m.id+'" value="'+(num(m.ap)?m.ap:"")+'" aria-label="7 m Team 2"></div>':'')+
     clockRow(m)+goalAdmin(m)+
     '<details class="more"><summary>Zeit und Halle ändern</summary><div class="mgrid"><input class="in" type="date" id="d-'+m.id+'" data-k="m.day" data-id="'+m.id+'" value="'+esc(mday(m))+'" aria-label="Tag"><input class="in" type="time" id="t-'+m.id+'" data-k="m.time" data-id="'+m.id+'" value="'+esc(m.time)+'" aria-label="Uhrzeit"><select class="in" id="p-'+m.id+'" data-k="m.pitch" data-id="'+m.id+'" aria-label="Halle">'+D.concept.halls.map(function(h){return opt(h.id,h.name,m.pitch)}).join("")+(D.concept.halls.some(function(h){return h.id===m.pitch})?'':opt(m.pitch||"",hallName(m.pitch)||"–",m.pitch||""))+'</select></div></details>'+saveRow(m)+'</div>'}).join("")+'</div>'
    :'<div class="empty">'+(afilter==="Offen"?"Alle Spiele sind beendet.":"Keine Spiele in dieser Auswahl.")+'</div>');
}
/* Spieluhr im Orga-Bereich: Anpfiff, Pause, Weiter, Abpfiff */
function clockRow(m){var c=m.clk,li=liveInfo(m),id=esc(m.id);
  if(!c)return '<div class="clk"><button class="btn blue sm" data-act="clkStart" data-id="'+id+'">▶ Anpfiff</button><span class="hint" style="margin:0">Erst mit Anpfiff läuft das Spiel live mit Spielminute.</span></div>';
  if(c.st==="end")return '<div class="clk"><span class="clk-st">Abgepfiffen nach '+Math.round(clkElapsed(m)/60e3)+' Min.</span><button class="btn ghost sm" data-act="clkResume" data-id="'+id+'">Weiterspielen</button>'+armBtn("clkReset",m.id,"Uhr zurücksetzen","Wirklich?","ghost sm")+'</div>';
  var nm=function(s){var t=resolve(m,s);return t?t.name:sideName(m,s)};
  return '<div class="clk live"><span class="clk-st"><i></i><span data-clk="'+id+'">'+minTxt(li)+'</span></span>'+
    (c.st==="run"?'<button class="btn ghost sm" data-act="clkPause" data-id="'+id+'">Pause</button>':'<button class="btn blue sm" data-act="clkResume" data-id="'+id+'">▶ Weiter</button>')+
    armBtn("clkEnd",m.id,"Abpfiff","Spiel beenden?","sm")+'</div>'+
    '<div class="goalbtns"><button class="btn ghost sm" data-act="goalH" data-id="'+id+'">+ Tor '+esc(nm("home"))+'</button><button class="btn ghost sm" data-act="goalA" data-id="'+id+'">+ Tor '+esc(nm("away"))+'</button></div>'}
function goalAdmin(m){var g=goalList(m);if(!g.length)return"";var nm=function(s){var t=resolve(m,s);return t?t.name:sideName(m,s)};
  return '<details class="more goals"><summary>Torfolge ('+g.length+') · Minuten korrigieren</summary>'+g.map(function(x){
    return '<div class="grow-row"><b>'+x.h+':'+x.a+'</b><span class="grow">'+esc(nm(x.s==="h"?"home":"away"))+'</span><input class="in" style="width:70px;text-align:center" inputmode="numeric" data-k="g.min" data-id="'+esc(m.id)+'" data-i="'+x.i+'" value="'+(x.min==null?"":x.min)+'" aria-label="Spielminute"><span>Min.</span><button class="btn icon sm" data-act="gDel" data-id="'+esc(m.id)+'" data-i="'+x.i+'" aria-label="Tor entfernen">×</button></div>'}).join("")+
    '<p class="hint" style="margin:6px 0 0">Änderungen hier mit „Speichern“ übernehmen. Ein entferntes Tor wird auch vom Spielstand abgezogen.</p></details>'}
function mvBtns(upAct,downAct,id,first,last,extra){return (first?'':'<button class="btn icon sm" data-act="'+upAct+'" data-id="'+id+'"'+(extra||'')+' aria-label="Nach oben">↑</button>')+(last?'':'<button class="btn icon sm" data-act="'+downAct+'" data-id="'+id+'"'+(extra||'')+' aria-label="Nach unten">↓</button>')}
function sw(k,on,label,sub){return '<label class="sw"><input type="checkbox" data-k="'+k+'"'+(on?' checked':'')+'><span class="sw-ui" aria-hidden="true"></span><span class="sw-t"><b>'+label+'</b>'+(sub?'<small>'+sub+'</small>':'')+'</span></label>'}
function aFood(D){
  var st=D.settings;
  var head='<div class="card"><h2 class="sec" style="margin-top:0">Speisen &amp; Getränke</h2>'+
    sw("set.foodOn",st.foodOn,"Bereich freischalten","Erst danach kannst du Theken, Speisen und Getränke pflegen.")+
    (st.foodOn?sw("set.foodLive",st.foodLive,"Auf der Turnierseite anzeigen",st.foodLive?"Aktiv: Kachel und Menüpunkt „Essen“ sind nach dem Veröffentlichen sichtbar.":"Aus: Besucher sehen nichts davon, du kannst in Ruhe vorbereiten."):'')+
    '<p class="hint" style="margin:10px 0 0"><span class="badge'+(st.foodOn&&st.foodLive?' on':'')+'">'+(!st.foodOn?'Nicht freigeschaltet – im Frontend aus':st.foodLive?'Im Frontend aktiv':'Freigeschaltet, im Frontend noch aus')+'</span></p></div>';
  if(!st.foodOn)return head;
  return head+'<p class="hint">Jede Theke (z. B. Cafeteria, Kuchentheke, Playersparty) hat eigene Kategorien. Mit + fügst du hinzu, mit − entfernst du. „Sichtbar“ aus blendet ein Angebot aus, ohne es zu löschen. Ausverkauftes bleibt sichtbar, aber durchgestrichen.</p>'+
   D.foodAreas.map(function(a,ai){
    var cs=D.menu.filter(function(c){return c.area===a.id});
    return '<div class="card farea"><div class="row"><input class="in grow" style="font-weight:800;font-size:1.05rem" id="fa-'+a.id+'" data-k="fa.name" data-id="'+a.id+'" value="'+esc(a.name)+'" aria-label="Name der Theke">'+mvBtns("faUp","faDown",a.id,ai===0,ai===D.foodAreas.length-1)+(D.foodAreas.length>1?armBtn("faDel",a.id,"−","Theke löschen?"):'')+'</div>'+
     '<input class="in" style="margin-top:6px" id="fat-'+a.id+'" data-k="fa.text" data-id="'+a.id+'" value="'+esc(a.text)+'" placeholder="Kurzbeschreibung (optional)" aria-label="Beschreibung der Theke">'+
     cs.map(function(c,ci){
      return '<div class="fcat"><div class="row"><input class="in grow" style="font-weight:700" id="c-'+c.id+'" data-k="cat.name" data-id="'+c.id+'" value="'+esc(c.name)+'" aria-label="Kategorie">'+mvBtns("catUp","catDown",c.id,ci===0,ci===cs.length-1)+armBtn("delCat",c.id,"−","Löschen?")+'</div>'+
      c.items.map(function(i,ii){return '<div class="fitem'+(i.hide?' hidden-it':'')+'"><div class="row"><input class="in grow" id="in-'+i.id+'" data-k="it.name" data-cid="'+c.id+'" data-id="'+i.id+'" value="'+esc(i.name)+'" aria-label="Name"><input class="in" style="width:86px;text-align:right" id="ip-'+i.id+'" inputmode="decimal" data-k="it.price" data-cid="'+c.id+'" data-id="'+i.id+'" value="'+String(i.price).replace(".",",")+'" aria-label="Preis in Euro"><span>€</span><button class="btn icon sm" data-act="delItem" data-cid="'+c.id+'" data-id="'+i.id+'" aria-label="Angebot entfernen">−</button></div>'+
       '<div class="row" style="margin-top:6px;flex-wrap:wrap"><input class="in grow" style="min-width:140px" id="it-'+i.id+'" data-k="it.note" data-cid="'+c.id+'" data-id="'+i.id+'" value="'+esc(i.note)+'" placeholder="Hinweis (optional)" aria-label="Hinweis">'+
       '<label class="ck"><input type="checkbox" id="iv-'+i.id+'" data-k="it.show" data-cid="'+c.id+'" data-id="'+i.id+'"'+(i.hide?"":" checked")+'>sichtbar</label><label class="ck"><input type="checkbox" id="io-'+i.id+'" data-k="it.out" data-cid="'+c.id+'" data-id="'+i.id+'"'+(i.out?" checked":"")+'>ausverkauft</label>'+mvBtns("itemUp","itemDown",i.id,ii===0,ii===c.items.length-1,' data-cid="'+c.id+'"')+'</div></div>'}).join("")+
      '<button class="btn ghost sm plus" data-act="addItem" data-id="'+c.id+'">+ Angebot</button></div>'}).join("")+
     '<button class="btn ghost sm plus" data-act="addCat" data-area="'+a.id+'" style="margin-top:10px">+ Kategorie</button></div>'}).join("")+
   '<button class="btn ghost plus" data-act="faAdd">+ Theke hinzufügen</button>';
}
function aInfo(D){
  return '<p class="hint">Diese Abschnitte erscheinen auf der Startseite hinter dem „i“. Zeilenumbrüche bleiben erhalten.</p>'+D.info.map(function(x,i){
    return '<div class="card"><div class="row"><input class="in grow" style="font-weight:800" id="if-'+x.id+'" data-k="info.title" data-id="'+x.id+'" value="'+esc(x.title)+'" aria-label="Überschrift">'+
     mvBtns("infoUp","infoDown",x.id,i===0,i===D.info.length-1)+armBtn("delInfo",x.id,"✕","Löschen?")+'</div>'+
     '<textarea class="in" style="margin-top:8px" id="it-'+x.id+'" data-k="info.text" data-id="'+x.id+'" aria-label="Text">'+esc(x.text)+'</textarea></div>'}).join("")+
   '<button class="btn ghost" data-act="addInfo">Abschnitt hinzufügen</button>';
}
function shiftCount(D){var day=curShDay(),tot=0,fil=0;shiftSlots(day).forEach(function(h){D.shiftAreas.forEach(function(a){if(D.shiftsOff[areaKey(day,h,a.id)])return;for(var i=0;i<a.n;i++){tot++;if((D.shifts[shiftKey(day,h,a.id,i)]||"").trim())fil++}})});return fil+" von "+tot+" Plätzen belegt"}
function aShifts(D){
  var day=curShDay(),slots=shiftSlots(day),sh=D.shifts;
  var cards=slots.map(function(h){
    return '<div class="card"><h2 class="sec" style="margin:0 0 8px">'+shLbl(day,h)+' Uhr</h2>'+D.shiftAreas.map(function(a){
      var ak=areaKey(day,h,a.id);
      if(D.shiftsOff[ak])return '<div class="row shoff" style="margin-top:8px"><span class="grow"><b>'+esc(a.name)+'</b> – keine Schicht</span><button class="btn ghost sm" data-act="shOn" data-id="'+esc(ak)+'">Wiederherstellen</button></div>';
      var ins='',has=false;for(var i=0;i<a.n;i++){var k=shiftKey(day,h,a.id,i),v=sh[k]||"";if(v.trim())has=true;
        ins+='<input class="in grow" id="sh-'+esc(k)+'" data-k="shift" data-id="'+esc(k)+'" value="'+esc(v)+'" placeholder="Name" aria-label="'+esc(a.name)+' '+hm(shStart(day,h))+' Person '+(i+1)+'">'}
      return '<div style="margin-top:8px"><div class="row" style="justify-content:space-between;margin-bottom:4px"><label class="f" style="margin:0">'+esc(a.name)+'</label>'+(has?armBtn("shOff",ak,"✕","Namen löschen?"):'<button class="btn icon sm" data-act="shOff" data-id="'+esc(ak)+'" aria-label="Schicht '+esc(a.name)+' '+hm(shStart(day,h))+' entfernen" title="Schicht entfernen">✕</button>')+'</div><div class="row">'+ins+'</div></div>'}).join("")+'</div>'}).join("");
  var areas='<details class="card more"><summary><b>Bereiche und Passwort</b></summary><p class="hint" style="margin-top:10px">Bereiche gelten für alle Stunden beider Tage. Die Zahl legt fest, wie viele Personen je Stunde eingeteilt werden.</p>'+
    D.shiftAreas.map(function(a,i){return '<div class="row" style="margin-top:8px"><input class="in grow" id="sa-'+a.id+'" data-k="sa.name" data-id="'+a.id+'" value="'+esc(a.name)+'" aria-label="Name des Bereichs"><select class="in" style="width:auto" id="san-'+a.id+'" data-k="sa.n" data-id="'+a.id+'" aria-label="Personen je Stunde">'+[1,2,3,4].map(function(n){return opt(String(n),n+(n===1?" Person":" Personen"),String(a.n))}).join("")+'</select>'+
      mvBtns("saUp","saDown",a.id,i===0,i===D.shiftAreas.length-1)+armBtn("saDel",a.id,"✕","Löschen?")+'</div>'}).join("")+
    '<button class="btn ghost sm" data-act="saAdd" style="margin-top:10px">Bereich hinzufügen</button>'+
    '<label class="f" for="shpwa">Passwort für die Schichtpläne</label><input class="in" id="shpwa" data-k="shpw" value="'+esc(D.shiftPw)+'" autocomplete="off"><p class="hint" style="margin-top:4px">Nach einer Änderung müssen alle Helfer das neue Passwort eingeben.</p></details>';
  return '<p class="hint">Schichten im Stundentakt ab dem ersten Anpfiff des Tages bis zum letzten Abpfiff in beiden Hallen (ändert sich die Anfangszeit im Spielplan, ziehen die Schichten automatisch mit). Ist ein Bereich in einer Stunde nicht besetzt, die Schicht mit ✕ entfernen. Mit „Veröffentlichen“ speichern. Für Helfer unten auf der Startseite unter „Schichtpläne“, Passwort '+esc(D.shiftPw)+'.</p>'+areas+
    dayChips(day)+'<p class="hint"><span class="badge" id="shbadge">'+shiftCount(D)+'</span></p>'+(slots.length?'<div class="rows">'+cards+'</div>':'<div class="empty">Für diesen Tag gibt es noch keine Spiele.</div>')}
function colorCard(D){var c=D.settings.colors,w=colorWarn(c);
  return '<div class="card"><h2 class="sec" style="margin-top:0">Farben der Turnierseite</h2><p class="hint">Hauptfarbe für Kopfbereich, Schaltflächen und Hervorhebungen, Zweitfarbe für Schrift und Symbole auf der Hauptfarbe. Hintergrund- und Randtöne passt die App automatisch an, auch im Dunkelmodus.</p>'+
   '<div class="presets">'+COLOR_PRESETS.map(function(p){var on=p[1]===c.primary.toUpperCase()&&p[2]===c.on.toUpperCase();return '<button class="preset" data-act="colPreset" data-p="'+p[1]+'" data-o="'+p[2]+'" aria-pressed="'+on+'" title="'+esc(p[0])+'"><span style="background:'+p[1]+';color:'+p[2]+'">Aa</span><small>'+esc(p[0])+'</small></button>'}).join("")+'</div>'+
   '<div class="mgrid two"><div><label class="f" for="colp">Hauptfarbe</label><div class="colrow"><input type="color" id="colp" data-k="col.primary" value="'+esc(c.primary)+'" aria-label="Hauptfarbe wählen"><input class="in" id="colph" data-k="col.primary" value="'+esc(c.primary.toUpperCase())+'" maxlength="7" aria-label="Hauptfarbe als Hex-Wert"></div></div>'+
   '<div><label class="f" for="colo">Zweitfarbe (Schrift)</label><div class="colrow"><input type="color" id="colo" data-k="col.on" value="'+esc(c.on)+'" aria-label="Zweitfarbe wählen"><input class="in" id="coloh" data-k="col.on" value="'+esc(c.on.toUpperCase())+'" maxlength="7" aria-label="Zweitfarbe als Hex-Wert"></div></div></div>'+
   '<div class="cprev" id="cprev" aria-hidden="true"><div class="cp-hero"><b>'+esc(fullTitle())+'</b><span>Vorschau</span></div><div class="cp-row"><span class="cp-chip">Ausgewählt</span><span class="cp-btn">Veröffentlichen</span><span class="cp-txt">Link-Farbe</span></div></div>'+
   '<p class="hint warn" id="colwarn" style="margin:8px 0 0">'+esc(w)+'</p>'+
   '<button class="btn ghost sm" data-act="colReset" style="margin-top:6px">Standard (Royalblau / Weiß)</button></div>'}
function aGeneral(D){
  var st=D.settings,days={};slotGroups(D).forEach(function(g){(days[g.day]=days[g.day]||[]).push(g)});
  var plan=Object.keys(days).sort().map(function(d){return '<h2 class="sec">'+esc(fmtDay(d))+'</h2><div class="mgrid">'+days[d].map(function(g){
      var last=g.ms[g.ms.length-1],end=last?tfmt(tmin(last.time)+durOf(D,last)):"";
      return '<div><label class="f" for="st-'+esc(d+g.hall)+'" style="margin-top:0">Start '+esc(hallName(g.hall,D))+'</label><input class="in" type="time" id="st-'+esc(d+g.hall)+'" data-k="start" data-day="'+esc(d)+'" data-hall="'+esc(g.hall)+'" value="'+esc(startOf(D,d,g.hall,g.ms))+'"><div class="hint" style="margin:4px 0 0">'+g.ms.length+' Spiele, Ende '+esc(end)+' Uhr</div></div>'}).join("")+'</div>'}).join("");
  var durs=D.concept.comps.map(function(c){return '<div><label class="f" for="dur-'+esc(c.id)+'" style="margin-top:0">'+esc(c.name)+' (Min.)</label><input class="in" id="dur-'+esc(c.id)+'" type="number" min="1" data-k="tp.dur" data-id="'+esc(c.id)+'" value="'+esc(c.dur)+'"></div>'}).join("");
  return '<div class="card"><h2 class="sec" style="margin-top:0">Turnier</h2>'+
   '<label class="f" for="stt" style="margin-top:0">Name des Turniers</label><input class="in" id="stt" data-k="set.title" value="'+esc(st.title)+'" placeholder="z. B. Novemberturnier, Jugendturnier U14">'+
   '<div class="mgrid two"><div><label class="f" for="sed">Auflage (Nummer)</label><input class="in" id="sed" type="number" min="1" inputmode="numeric" data-k="set.edition" value="'+esc(ed()||"")+'" placeholder="leer = ohne"></div>'+
   '<div><label class="f" for="sp">Ort</label><input class="in" id="sp" data-k="set.place" value="'+esc(st.place)+'"></div></div>'+
   '<label class="f" for="sd">Datum als Text</label><input class="in" id="sd" data-k="set.date" value="'+esc(st.date)+'">'+
   '<div class="mgrid two"><div><label class="f" for="scl">Verein</label><input class="in" id="scl" data-k="set.club" value="'+esc(st.club)+'"></div><div><label class="f" for="sdp">Zusatz (z. B. Abteilung)</label><input class="in" id="sdp" data-k="set.dept" value="'+esc(st.dept)+'"></div></div>'+
   '<p class="hint" style="margin:10px 0 0">Auf der Startseite steht dann: <b id="edprev">'+esc(fullTitle())+'</b></p></div>'+
   colorCard(D)+
   '<div class="card"><h2 class="sec" style="margin-top:0">Vereinslogo</h2><div class="upl"><span class="lg" style="--s:56px"><img src="'+curLogo()+'" alt=""></span><label class="btn ghost sm">Logo ersetzen<input type="file" accept="image/png,image/jpeg" data-clublogo="1"></label></div></div>'+
   '<div class="card"><h2 class="sec" style="margin-top:0">Spielzeiten und Starts</h2><p class="hint">Änderst du hier einen Wert, rechnet die App alle Anstoßzeiten neu: Spiele einer Halle laufen am Tag in ihrer bisherigen Reihenfolge nacheinander, jeweils Spielzeit plus Wechsel. Einzeln geänderte Zeiten werden dabei überschrieben.</p>'+
   '<div class="mgrid">'+durs+'<div><label class="f" for="spa" style="margin-top:0">Wechsel (Min.)</label><input class="in" id="spa" type="number" min="0" data-k="tp.pause" value="'+esc(st.pause==null?5:st.pause)+'"></div></div>'+plan+'<p class="hint" style="margin-top:14px">Spielplan aus der Vorlage im Repository übernehmen (Paarungen, Runden, Hallen, Zeiten). Teamnamen, Logos und Ergebnisse unveränderter Spiele bleiben erhalten.</p>'+armBtn("loadPlan","","Spielplan aus Vorlage übernehmen","Wirklich übernehmen?","ghost sm")+'</div>'+
   '<div class="card"><h2 class="sec" style="margin-top:0">Live-Anzeige</h2><p class="hint">Mit Spielzeit und echter Uhrzeit erkennt der Spielplan, welche Spiele gerade laufen. Ein Spiel bleibt live, bis seine Spielzeit laut Uhrzeit vorbei ist, auch wenn schon ein Zwischenstand gespeichert ist.</p>'+
   '<label class="f" for="sday" style="margin-top:0">Erster Turniertag</label><input class="in" id="sday" type="date" data-k="set.day" value="'+esc(st.day||"")+'"></div>'+
   '<div class="card dz"><h2 class="sec" style="margin-top:0">Neues Turnierjahr vorbereiten</h2><p class="hint">Löscht alle Ergebnisse (auch 7-m-Schießen) und setzt Halbfinals, Platzierungs- und Finalspiele wieder auf „Automatisch“. Teams, Logos, Spielplan, Zeiten, Infos und Schichtpläne bleiben. Die Änderung ist sofort online. Lade vorher am besten eine Sicherung herunter.</p><div class="rows"><button class="btn ghost sm" data-act="backup">Sicherung herunterladen</button><button class="btn sm" data-act="resetResults">Alle Ergebnisse löschen</button></div><p class="hint" style="margin:10px 0 0">Danach hier Auflage, Turniertag und Datum anpassen und veröffentlichen. Für ein ganz anderes Turnier (andere Teamzahl, Jugend) den Plan unter „Turnierkonzept“ neu erzeugen.</p></div>'+
   '<p class="hint">Veröffentlichen speichert alles in Firebase. Alle geöffneten Ansichten aktualisieren sich danach von selbst.</p>';
}
/* ---------- Farben ---------- */
function hex2rgb(h){h=String(h||"").trim().replace(/^#/,"");if(h.length===3)h=h.replace(/./g,"$&$&");if(!/^[0-9a-f]{6}$/i.test(h))return null;return [0,2,4].map(function(i){return parseInt(h.substr(i,2),16)})}
function rgb2hex(r){return "#"+r.map(function(v){return Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")}).join("").toUpperCase()}
function normHex(h){var r=hex2rgb(h);return r?rgb2hex(r):null}
function mixc(a,b,t){var x=hex2rgb(a),y=hex2rgb(b);return rgb2hex(x.map(function(v,i){return v+(y[i]-v)*t}))}
function lum(h){var c=hex2rgb(h).map(function(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]}
function contrast(a,b){var x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
/* Farbe so lange Richtung Schwarz/Weiß schieben, bis sie auf dem Hintergrund lesbar ist */
function toward(c,bg,dir,min){var r=c,t=0;while(contrast(r,bg)<min&&t<1){t+=.05;r=mixc(c,dir,t)}return r}
function themeVars(p,o){var lt=lum(o)>.4,dsurf=mixc(p,"#121318",.84);
  return {L:{royal:p,"royal-ink":toward(p,"#FFFFFF","#000000",4.5),deep:toward(mixc(p,"#000000",lt?.4:.12),o,lt?"#000000":"#FFFFFF",4.5),"on-royal":o,
      soft:mixc(p,"#FFFFFF",.88),bg:mixc(p,"#FFFFFF",.93),line:mixc(mixc(p,"#8A8F9C",.6),"#FFFFFF",.62),ink:mixc(p,"#05070C",.85),muted:toward(mixc(p,"#585E6E",.82),"#FFFFFF","#000000",4.6)},
    D:{royal:lum(p)<.05?mixc(p,"#FFFFFF",.18):p,"royal-ink":toward(mixc(p,"#FFFFFF",.45),dsurf,"#FFFFFF",4.5),deep:toward(mixc(p,"#000000",lt?.5:.2),o,lt?"#000000":"#FFFFFF",4.5),"on-royal":o,
      soft:mixc(p,"#16171C",.72),bg:mixc(p,"#08090C",.9),surface:dsurf,line:mixc(p,"#2B2E37",.78),ink:"#EEF0F6",muted:toward(mixc(p,"#A3A8B5",.82),dsurf,"#FFFFFF",4.6)}}}
var _theme="";
function applyTheme(){var c=S().settings.colors,key=c.primary+c.on;if(key===_theme)return;_theme=key;
  var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=c.primary;
  var el=document.getElementById("theme-css");
  if(c.primary.toUpperCase()===DEFAULT_COLORS.primary&&c.on.toUpperCase()===DEFAULT_COLORS.on){if(el)el.remove();return}
  if(!el){el=document.createElement("style");el.id="theme-css";document.head.appendChild(el)}
  var v=themeVars(c.primary,c.on),f=function(o){return Object.keys(o).map(function(k){return "--"+k+":"+o[k]}).join(";")};
  el.textContent=":root{"+f(v.L)+'}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){'+f(v.D)+'}}:root[data-theme="dark"]{'+f(v.D)+"}"}
function colorWarn(c){var k=contrast(c.on,c.primary);return k<3?"Die Zweitfarbe ist auf der Hauptfarbe schlecht lesbar (Kontrast "+k.toFixed(1).replace(".",",")+":1). Besser eine hellere oder dunklere Zweitfarbe wählen.":""}

/* ---------- Turnierkonzept: Spielplan-Generator ---------- */
var LET="ABCDEFGH";
function groupSizes(n,g){var b=Math.floor(n/g),r=n%g,o=[];for(var i=0;i<g;i++)o.push(b+(i<r?1:0));return o}
/* Jeder gegen jeden (Kreismethode), optional mit Rückspiel */
function rrRounds(ids,twice){var a=ids.slice();if(a.length%2)a.push(null);var n=a.length,R=[];
  for(var r=0;r<n-1;r++){var gs=[];for(var i=0;i<n/2;i++){var h=a[i],w=a[n-1-i];if(h&&w)gs.push((i+r)%2?[w,h]:[h,w])}R.push(gs);a.splice(1,0,a.pop())}
  if(twice)R=R.concat(R.map(function(gs){return gs.map(function(p){return[p[1],p[0]]})}));return R}
/* Finalrunde je Wettbewerb: Halbfinale, Platz gegen Platz oder nur Tabelle */
function koPlan(c,G){
  var out=[];if(c.mode==="league")return out;
  var P=function(g,p){return{k:"g",g:g.g,p:p}},L=function(g,p){return p+". "+(G.length>1?"Gruppe "+gLetter(g.g):"der Tabelle")};
  function add(round,h,a,hn,an){var o={key:"k"+out.length,round:round,hsrc:h,asrc:a,hn:hn,an:an};out.push(o);return o}
  function sfEnd(s1,s2){if(c.third)add("Spiel um Platz 3",{k:"l",m:s1.key},{k:"l",m:s2.key},"Verlierer 1. Halbfinale","Verlierer 2. Halbfinale");
    add("Finale",{k:"w",m:s1.key},{k:"w",m:s2.key},"Sieger 1. Halbfinale","Sieger 2. Halbfinale")}
  var p,s1,s2;
  if(G.length===2){var A=G[0],B=G[1],m=Math.min(A.n,B.n),pl=function(p,r){add(r,P(A,p),P(B,p),L(A,p),L(B,p))};
    if(c.mode==="semis"&&m>=2){s1=add("1. Halbfinale",P(A,1),P(B,2),L(A,1),L(B,2));s2=add("2. Halbfinale",P(B,1),P(A,2),L(B,1),L(A,2));
      if(c.places)for(p=m;p>=3;p--)pl(p,"Spiel um Platz "+(2*p-1));sfEnd(s1,s2)}
    else for(p=m;p>=1;p--){if((p>=3&&!c.places)||(p===2&&!c.third))continue;pl(p,p===1?"Finale":"Spiel um Platz "+(2*p-1))}}
  else{var X=G[0],n=X.n,pr=function(x,y,r){return add(r,P(X,x),P(X,y),L(X,x),L(X,y))};
    if(c.mode==="semis"&&n>=4){s1=pr(1,4,"1. Halbfinale");s2=pr(2,3,"2. Halbfinale");
      if(c.places)for(p=n-(n%2)-1;p>=5;p-=2)pr(p,p+1,"Spiel um Platz "+p);sfEnd(s1,s2)}
    else for(p=n-(n%2)-1;p>=1;p-=2){if((p>=5&&!c.places)||(p===3&&!c.third))continue;pr(p,p+1,p===1?"Finale":"Spiel um Platz "+p)}}
  return out}
/* Listen mehrerer Wettbewerbe in einer Halle gleichmäßig verzahnen (Finals beider am Ende) */
function mergeLists(lists){var all=[];lists.forEach(function(l,li){l.forEach(function(m,i){all.push({m:m,f:(i+1)/l.length,li:li})})});all.sort(function(a,b){return a.f-b.f||a.li-b.li});return all.map(function(x){return x.m})}
/* Möglichst kein Team zweimal direkt hintereinander */
function spread(list){var out=[],pool=list.slice();while(pool.length){var l=out[out.length-1],k=0;
  if(l){var j=pool.findIndex(function(m,ix){return ix<10&&[m.home,m.away].every(function(t){return t!==l.home&&t!==l.away})});if(j>0)k=j}out.push(pool.splice(k,1)[0])}return out}
function compCode(c,used){var code=(String(c.code||c.name||"X").replace(/[^A-Za-z0-9]/g,"").slice(0,3)||"X").toUpperCase(),b=code,k=2;while(used[code])code=b+(k++);used[code]=1;return code}
function generate(D){
  var cn=D.concept,days=cn.days.slice().filter(function(d){return d.d}).sort(function(a,b){return a.d.localeCompare(b.d)}),pause=+D.settings.pause;if(isNaN(pause)||pause<0)pause=5;
  if(!days.length)days=[{d:isoToday(),start:"09:30",end:"19:00"}];
  var teams=[],byHall={},sum={},used={},codes={};
  cn.comps.forEach(function(c){
    var code=codes[c.id]=compCode(c,used),old=D.teams.filter(function(t){return gCat(t.group)===c.id}),j=0,G=[],gm=[];
    groupSizes(c.teams,c.groups).forEach(function(n,gi){var g=c.id+" "+LET[gi],ids=[];
      for(var k=1;k<=n;k++){var o=old[j++],id=code.toLowerCase()+LET[gi]+k;teams.push({id:id,name:o?o.name:"Team "+(c.groups>1?LET[gi]:"")+k,group:g,logo:o?o.logo||"":""});ids.push(id)}
      G.push({g:g,n:n});gm.push(rrRounds(ids,c.rr===2).map(function(rs){return rs.map(function(p){return{cat:c.id,group:g,round:"",home:p[0],away:p[1],hn:"",an:""}})}))});
    var grp=[],mr=Math.max.apply(null,gm.map(function(x){return x.length}));for(var r=0;r<mr;r++)gm.forEach(function(x){grp=grp.concat(x[r]||[])});
    var ko=koPlan(c,G).map(function(o){o.cat=c.id;o.group="";o.home="";o.away="";return o});
    var h=byHall[c.hall]=byHall[c.hall]||{g:[],k:[]};h.g.push(grp);h.k.push(ko);
    sum[c.id]={sizes:G.map(function(x){return x.n}),g:grp.length,k:ko.length,min:(grp.length+ko.length)*c.dur}});
  var ms=[],over={},end=function(d){var t=tmin(d.end);return t===null?1440:t};
  Object.keys(byHall).forEach(function(h){
    var gl=spread(mergeLists(byHall[h].g)),kl=mergeLists(byHall[h].k),di=0,t=tmin(days[0].start);if(t===null)t=570;
    function place(m){var d=durOf(D,m);
      while(di<days.length-1&&t+d>end(days[di])){di++;t=tmin(days[di].start);if(t===null)t=570}
      if(t+d>end(days[di]))over[h]=tfmt(t+d);
      m.day=days[di].d;m.time=tfmt(t);m.pitch=h;t+=d+pause}
    gl.forEach(place);
    if(cn.flast&&kl.length&&di<days.length-1){di=days.length-1;t=tmin(days[di].start);if(t===null)t=570}
    kl.forEach(place);ms=ms.concat(gl,kl)});
  ms.sort(function(a,b){return a.day.localeCompare(b.day)||tmin(a.time)-tmin(b.time)||String(a.pitch).localeCompare(String(b.pitch))});
  var cnt={},keys={};
  ms.forEach(function(m){cnt[m.cat]=(cnt[m.cat]||0)+1;m.id=codes[m.cat]+cnt[m.cat];if(m.key)keys[m.cat+"|"+m.key]=m.id});
  var starts={},span={};
  var out=ms.map(function(m){var o={id:m.id,cat:m.cat,day:m.day,time:m.time,pitch:m.pitch,group:m.group,round:m.round,home:m.home,away:m.away,hn:m.hn,an:m.an,hs:null,as:null,hp:null,ap:null};
    ["hsrc","asrc"].forEach(function(f){var sp=m[f];if(!sp)return;o[f]=sp.k==="g"?{k:"g",g:sp.g,p:sp.p}:{k:sp.k,m:keys[m.cat+"|"+sp.m]}});
    var ss=starts[m.day]=starts[m.day]||{};if(!ss[m.pitch])ss[m.pitch]=m.time;
    var sk=m.day+"|"+m.pitch,e=tmin(m.time)+durOf(D,m);span[sk]=span[sk]||{d:m.day,h:m.pitch,n:0,a:m.time,e:0};span[sk].n++;span[sk].e=Math.max(span[sk].e,e);
    return o});
  return {teams:teams,matches:out,starts:starts,day:days[0].d,over:over,sum:sum,span:Object.keys(span).sort().map(function(k){return span[k]})}}
function applyGenerate(){var r=generate(DRAFT);DRAFT.teams=r.teams;DRAFT.matches=r.matches;DRAFT.settings.starts=r.starts;DRAFT.settings.day=r.day;
  clearCache();markDirty();render(true);toast(r.matches.length+" Spiele und "+r.teams.length+" Teams erzeugt. Prüfen und veröffentlichen.")}
function aConcept(D){
  var cn=D.concept,r=generate(D),hasRes=D.matches.some(hasScore);
  var days='<div class="card"><h2 class="sec" style="margin-top:0">Turniertage</h2><p class="hint">Je Tag erster Anpfiff und spätestes Spielende. Was nicht mehr hineinpasst, rutscht auf den nächsten Tag.</p>'+
    cn.days.map(function(d,i){return '<div class="cday"><input class="in" type="date" data-k="cn.day.d" data-i="'+i+'" value="'+esc(d.d)+'" aria-label="Datum Tag '+(i+1)+'"><input class="in" type="time" data-k="cn.day.start" data-i="'+i+'" value="'+esc(d.start)+'" aria-label="Erster Anpfiff"><span>bis</span><input class="in" type="time" data-k="cn.day.end" data-i="'+i+'" value="'+esc(d.end)+'" aria-label="Spätestes Ende">'+(cn.days.length>1?'<button class="btn icon sm" data-act="cnDayDel" data-i="'+i+'" aria-label="Tag entfernen">−</button>':'')+'</div>'}).join("")+
    '<button class="btn ghost sm plus" data-act="cnDayAdd">+ Tag</button><div style="margin-top:12px">'+sw("cn.flast",cn.flast,"Finalspiele erst am letzten Tag","Halbfinale, Platzierungsspiele und Finale gesammelt am letzten Turniertag.")+'</div>'+
    '<label class="f" for="cnp">Wechsel zwischen zwei Spielen (Min.)</label><input class="in" style="max-width:120px" id="cnp" type="number" min="0" data-k="tp.pause" value="'+esc(D.settings.pause==null?5:D.settings.pause)+'"></div>';
  var halls='<div class="card"><h2 class="sec" style="margin-top:0">Hallen</h2>'+cn.halls.map(function(h){return '<div class="row" style="margin-top:6px"><input class="in grow" data-k="cn.hall.name" data-id="'+esc(h.id)+'" value="'+esc(h.name)+'" aria-label="Name der Halle">'+(cn.halls.length>1?armBtn("cnHallDel",h.id,"−","Entfernen?"):'')+'</div>'}).join("")+
    '<button class="btn ghost sm plus" data-act="cnHallAdd" style="margin-top:10px">+ Halle</button></div>';
  var cc=cn.comps.map(function(c){var one=c.groups===1,sm=r.sum[c.id]||{sizes:[],g:0,k:0,min:0},sz=sm.sizes;
    var modes=[["semis",one?"Halbfinale: 1.–4. und 2.–3. der Tabelle":"Halbfinale: Gruppenerste gegen Gruppenzweite über Kreuz"],["place",one?"Platzierungsspiele: 1.–2. Finale, 3.–4. um Platz 3 …":"Platz gegen Platz: 1.–1. Finale, 2.–2. um Platz 3 …"],["league","Keine Finalrunde – die Tabelle entscheidet"]];
    var warn=[];if(sz.some(function(n){return n<2}))warn.push("Mindestens zwei Teams je Gruppe nötig.");
    if(sz.length===2&&sz[0]!==sz[1]&&c.mode!=="league")warn.push("Ungleiche Gruppen: Der Letzte der größeren Gruppe bekommt seinen Platz aus der Tabelle.");
    if(one&&c.mode==="semis"&&c.teams<4)warn.push("Für Halbfinale braucht es mindestens vier Teams.");
    return '<div class="card comp"><div class="row"><input class="in grow" style="font-weight:800;font-size:1.05rem" data-k="cn.c.name" data-id="'+esc(c.id)+'" value="'+esc(c.name)+'" aria-label="Name des Wettbewerbs" placeholder="z. B. Damen, Herren, U14 männlich"><input class="in" style="width:62px;text-align:center" data-k="cn.c.code" data-id="'+esc(c.id)+'" value="'+esc(c.code)+'" maxlength="3" aria-label="Kürzel für Spielnummern" title="Kürzel für Spielnummern (z. B. D1, H1)">'+(cn.comps.length>1?armBtn("cnCompDel",c.id,"−","Entfernen?"):'')+'</div>'+
     '<label class="f">Teams</label><div class="row wrapr"><div class="stepper"><button class="btn icon sm" data-act="cnTeams" data-id="'+esc(c.id)+'" data-n="'+(c.teams-1)+'" aria-label="Ein Team weniger">−</button><b aria-live="polite">'+c.teams+'</b><button class="btn icon sm" data-act="cnTeams" data-id="'+esc(c.id)+'" data-n="'+(c.teams+1)+'" aria-label="Ein Team mehr">+</button></div>'+
       [6,8,10,12].map(function(n){return '<button class="chip" data-act="cnTeams" data-id="'+esc(c.id)+'" data-n="'+n+'" aria-pressed="'+(c.teams===n)+'">'+n+'</button>'}).join("")+'</div>'+
     '<div class="mgrid two"><div><label class="f">Gruppen</label><div class="row">'+[1,2].map(function(g){return '<button class="chip" data-act="cnGroups" data-id="'+esc(c.id)+'" data-n="'+g+'" aria-pressed="'+(c.groups===g)+'">'+(g===1?"Eine Gruppe":"Zwei Gruppen")+'</button>'}).join("")+'</div></div>'+
       '<div><label class="f" for="ch-'+esc(c.id)+'">Halle</label><select class="in" id="ch-'+esc(c.id)+'" data-k="cn.c.hall" data-id="'+esc(c.id)+'">'+cn.halls.map(function(h){return opt(h.id,h.name,c.hall)}).join("")+'</select></div></div>'+
     '<div class="mgrid two"><div><label class="f" for="cr-'+esc(c.id)+'">Gruppenspiele</label><select class="in" id="cr-'+esc(c.id)+'" data-k="cn.c.rr" data-id="'+esc(c.id)+'">'+opt("1","Jeder gegen jeden",String(c.rr))+opt("2","Mit Rückspiel",String(c.rr))+'</select></div>'+
       '<div><label class="f" for="cd-'+esc(c.id)+'">Spielzeit (Min.)</label><input class="in" id="cd-'+esc(c.id)+'" type="number" min="1" data-k="tp.dur" data-id="'+esc(c.id)+'" value="'+esc(c.dur)+'"></div></div>'+
     '<label class="f" for="cm-'+esc(c.id)+'">Finalrunde</label><select class="in" id="cm-'+esc(c.id)+'" data-k="cn.c.mode" data-id="'+esc(c.id)+'">'+modes.map(function(m){return opt(m[0],m[1],c.mode)}).join("")+'</select>'+
     (c.mode!=="league"?'<div class="row wrapr" style="margin-top:10px"><label class="ck"><input type="checkbox" data-k="cn.c.third" data-id="'+esc(c.id)+'"'+(c.third?" checked":"")+'>Spiel um Platz 3</label><label class="ck"><input type="checkbox" data-k="cn.c.places" data-id="'+esc(c.id)+'"'+(c.places?" checked":"")+'>Spiele um Platz 5 und folgende</label></div>':'')+
     '<p class="csum">'+(one?"Eine Gruppe mit "+c.teams+" Teams":"Gruppen mit "+sz.join(" und ")+" Teams")+' · '+sm.g+' Gruppenspiele · '+sm.k+' Finalspiele · '+Math.floor(sm.min/60)+' Std. '+(sm.min%60?sm.min%60+' Min. ':'')+'reine Spielzeit</p>'+
     (warn.length?'<p class="hint warn" style="margin:6px 0 0">'+warn.map(esc).join("<br>")+'</p>':'')+'</div>'}).join("");
  var ov=Object.keys(r.over);
  var prev='<div class="card"><h2 class="sec" style="margin-top:0">Vorschau Zeitplan</h2>'+(r.span.length?'<div class="cprevlist">'+r.span.map(function(x){return '<div><b>'+esc(fmtDay(x.d,{weekday:"short",day:"numeric",month:"numeric"}))+' · '+esc(hallName(x.h,D))+'</b><span>'+x.n+' Spiele, '+esc(x.a)+'–'+tfmt(x.e)+' Uhr</span></div>'}).join("")+'</div>':'<p class="hint">Noch keine Spiele.</p>')+
    (ov.length?'<p class="hint warn" style="margin:10px 0 0">'+ov.map(function(h){return "Achtung: In "+esc(hallName(h,D))+" passen nicht alle Spiele in die Turniertage (letztes Spiel endet um "+r.over[h]+" Uhr). Spielzeit, Wechsel, Zeiten oder Tage anpassen."}).join("<br>")+'</p>':'')+'</div>';
  return '<p class="hint">Hier legst du fest, wie das Turnier aufgebaut ist: welche Wettbewerbe es gibt, wie viele Teams in wie vielen Gruppen spielen und wie die Finalrunde aussieht. Mit „Spielplan erzeugen“ entstehen daraus Teams und Spielplan. Erst „Veröffentlichen“ bringt alles online.</p>'+
    days+halls+'<h2 class="sec">Wettbewerbe</h2>'+cc+'<button class="btn ghost plus" data-act="cnCompAdd" style="margin-bottom:12px">+ Wettbewerb hinzufügen</button>'+prev+
    '<div class="card gen"><h2 class="sec" style="margin-top:0">Spielplan und Teams erzeugen</h2><p class="hint">Erzeugt alle Spiele und Teams neu nach diesem Konzept. Bisherige Teamnamen und Logos bleiben je Wettbewerb in ihrer Reihenfolge erhalten. Schichtpläne, Infos und Karte bleiben unverändert.'+(hasRes?' <b>Achtung: Es sind bereits Ergebnisse eingetragen – sie werden dabei gelöscht.</b> Vorher unter „Allgemein“ eine Sicherung herunterladen.':'')+'</p>'+
    armBtn("cnGen","","Spielplan und Teams erzeugen","Wirklich neu erzeugen?","blue")+'</div>';
}
/* Spielplan aus default-state.json übernehmen, Ergebnisse unveränderter Spiele behalten */
async function loadPlan(){
  try{var def=await (await fetch("default-state.json",{cache:"no-cache"})).json()}catch(e){toast("Vorlage konnte nicht geladen werden.");return}
  var keep={};DRAFT.matches.forEach(function(m){keep[m.id]=m});
  var same=function(a,b){return a&&b&&a.cat===b.cat&&a.group===b.group&&a.round===b.round&&a.home===b.home&&a.away===b.away&&JSON.stringify(a.hsrc||null)===JSON.stringify(b.hsrc||null)&&JSON.stringify(a.asrc||null)===JSON.stringify(b.asrc||null)};
  DRAFT.matches=def.matches.map(function(m){var o=keep[m.id];if(same(o,m)){["hs","as","hp","ap"].forEach(function(f){m[f]=o[f]})}return m});
  ["durD","durH","pause","starts"].forEach(function(k){if(def.settings&&def.settings[k]!=null)DRAFT.settings[k]=clone(def.settings[k])});
  clearCache();markDirty();render(true);toast("Spielplan übernommen. Zum Anzeigen veröffentlichen.")}
function isDirty(){return !!DRAFT&&JSON.stringify(DRAFT)!==JSON.stringify(STATE)}
function vAdmin(){
  var D=DRAFT,body=({teams:aTeams,plan:aPlan,concept:aConcept,info:aInfo,food:aFood,shifts:aShifts,general:aGeneral}[atab]||aPlan)(D),d=isDirty();
  return '<div class="ph"><div class="wrap"><img src="'+curLogo()+'" alt="Zur Startseite" role="button" tabindex="0" data-go="home"><h1>Orga</h1><button class="info-btn out" data-atab="info" aria-label="Infos bearbeiten">i</button><button class="btn ghost sm" data-act="logout">Abmelden</button></div>'+
   '<div class="wrap"><div class="atabs">'+ATABS.map(function(a){return '<button class="chip" data-atab="'+a[0]+'" aria-pressed="'+(a[0]===atab)+'">'+a[1]+'</button>'}).join("")+'</div></div></div>'+
   '<main style="padding-bottom:120px"><div class="wrap">'+body+'</div></main>'+
   '<div class="savebar"><div class="wrap"><span class="st'+(d?" dirty":"")+'" id="st">'+(publishing?"Wird veröffentlicht …":d?"Ungespeicherte Änderungen":"Alles veröffentlicht")+'</span>'+armBtn("reset","","Verwerfen","Wirklich verwerfen?","ghost sm")+'<button class="btn blue sm" data-act="publish"'+(d&&!publishing?"":" disabled")+'>Veröffentlichen</button></div></div>';
}

/* ---------- Darstellung ---------- */
function render(keep){
  if(!STATE){app.innerHTML='<main><div class="wrap"><p class="empty" style="margin-top:30vh">Turnierdaten werden geladen …</p></div></main>';return}
  var y=window.scrollY;clearCache();if(route!=="admin")DRAFT=null;applyTheme();document.title=fullTitle();
  if(route==="food"&&!foodVisible())route="home";
  if(route==="admin"){if(!authed()){app.innerHTML=vLogin();bindLogin();return}if(!DRAFT)loadDraft();applyTheme();app.innerHTML=vAdmin()}
  else{app.innerHTML=({home:vHome,plan:vPlan,teams:vTeams,table:vTable,info:vInfo,shifts:vShifts,food:vFood}[route]||vHome)()}
  if(keep)window.scrollTo(0,y);
}
function go(r){route=r;saveResume();render(false);window.scrollTo(0,0);if(r==="plan"){var g=document.querySelector(".game.live")||document.querySelector(".game.next");if(g&&g.getBoundingClientRect().top>innerHeight*.6)g.scrollIntoView({block:"center"})}}
function loadDraft(){var d=lsGet("nt-draft");if(d&&d.base===STATE.updated&&d.state){DRAFT=norm(d.state)}else{DRAFT=clone(STATE)}}
function saveDraft(){lsSet("nt-draft",{base:STATE.updated,state:DRAFT})}
function markDirty(){saveDraft();var st=document.getElementById("st"),d=isDirty();
  if(st){st.textContent=publishing?"Wird veröffentlicht …":d?"Ungespeicherte Änderungen":"Alles veröffentlicht";st.className="st"+(d?" dirty":"")}
  document.querySelectorAll('[data-act="publish"]').forEach(function(b){b.disabled=!d||publishing})}
function toast(t){var o=document.querySelector(".toast");if(o)o.remove();var d=document.createElement("div");d.className="toast";d.setAttribute("role","status");d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove()},3000)}

function bindLogin(){document.getElementById("lf").addEventListener("submit",async function(e){e.preventDefault();
  var err=document.getElementById("lerr");
  if(!FB){err.textContent="Firebase ist noch nicht eingerichtet (firebase-config.js).";return}
  err.textContent="Anmeldung läuft …";
  try{await signInWithEmailAndPassword(FB.auth,document.getElementById("lu").value.trim(),document.getElementById("lp").value);err.textContent=""}
  catch(x){err.textContent=x&&x.code==="auth/too-many-requests"?"Zu viele Versuche. Bitte kurz warten.":"E-Mail oder Passwort stimmt nicht."}})}

function findM(id){return DRAFT.matches.find(function(m){return m.id===id})}
function findC(id){return DRAFT.menu.find(function(c){return c.id===id})}
function parseNum(v){v=String(v).trim().replace(",",".");if(v==="")return null;var n=parseFloat(v);return isNaN(n)?null:n}

app.addEventListener("input",function(e){
  if(e.target.id==="shq"){shQ=e.target.value;document.getElementById("shres").innerHTML=shiftResults(shQ);document.getElementById("shall").style.display=shQ.trim()?"none":"";return}
  var el=e.target,k=el.dataset.k;if(!k||!DRAFT)return;var id=el.dataset.id,v=el.type==="checkbox"?el.checked:el.value;
  if(k==="team.name")DRAFT.teams.find(function(t){return t.id===id}).name=v;
  else if(k==="g.min"){var gm=findM(id),gg=gm&&gm.goals&&gm.goals[+el.dataset.i];if(!gg)return;var gn=parseNum(v);gg.min=gn===null?null:Math.max(1,Math.round(gn));updRes(id)}
  else if(k.indexOf("m.")===0){var m=findM(id),f=k.slice(2);
    if(f==="hs"||f==="as"||f==="hp"||f==="ap"){var n=parseNum(v);m[f]=n===null?null:Math.max(0,Math.round(n))}else m[f]=v;
    if(f==="home"||f==="away"||f==="pitch"){markDirty();render(true);return}
    updRes(id)}
  else if(k.indexOf("it.")===0){var c=findC(el.dataset.cid),it=c.items.find(function(i){return i.id===id}),g=k.slice(3);
    if(g==="price"){var p=parseNum(v);it.price=p===null?0:p}else if(g==="show"){it.hide=!v;markDirty();render(true);return}else it[g]=v}
  else if(k==="fa.name"||k==="fa.text")DRAFT.foodAreas.find(function(a){return a.id===id})[k.slice(3)]=v;
  else if(k==="cat.name")findC(id).name=v;
  else if(k==="info.title"||k==="info.text")DRAFT.info.find(function(x){return x.id===id})[k.slice(5)]=v;
  else if(k==="set.foodOn"||k==="set.foodLive"){DRAFT.settings[k.slice(4)]=!!v;markDirty();render(true);return}
  else if(k.indexOf("set.")===0){var f=k.slice(4);
    if(f==="edition"){var en=parseInt(v,10);DRAFT.settings.edition=en>0?en:null}else DRAFT.settings[f]=v;
    if(f==="title"&&!String(v).trim())DRAFT.settings.title="Turnier";
    var pv=document.getElementById("edprev");if(pv)pv.textContent=fullTitle()}
  else if(k.indexOf("col.")===0){var hx=normHex(v);if(!hx)return;var cf=k.slice(4);DRAFT.settings.colors[cf]=hx;
    var pair=cf==="primary"?["colp","colph"]:["colo","coloh"];pair.forEach(function(pid){var pe=document.getElementById(pid);if(pe&&pe!==el)pe.value=pe.type==="color"?hx.toLowerCase():hx});
    applyTheme();var cw=document.getElementById("colwarn");if(cw)cw.textContent=colorWarn(DRAFT.settings.colors)}
  else if(k.indexOf("cn.")===0){if(cnInput(el,k,id,v))return}
  else if(k==="shift"){if(String(v).trim())DRAFT.shifts[id]=v;else delete DRAFT.shifts[id];var bd=document.getElementById("shbadge");if(bd)bd.textContent=shiftCount(DRAFT)}
  else if(k==="sa.name")DRAFT.shiftAreas.find(function(a){return a.id===id}).name=v;
  else if(k==="sa.n"){var sa=DRAFT.shiftAreas.find(function(a){return a.id===id}),nn=+v;
    /* Namen auf wegfallenden Plätzen entfernen */
    Object.keys(DRAFT.shifts).forEach(function(key){var p=key.split("|");if(p[1]===id&&+p[2]>=nn)delete DRAFT.shifts[key]});
    sa.n=nn;markDirty();render(true);return}
  else if(k==="shpw")DRAFT.shiftPw=v;
  else if(k.indexOf("tp.")===0||k==="start")return;
  markDirty();
});
/* Zeitplan-Einstellungen: erst nach fertiger Eingabe neu rechnen */
app.addEventListener("change",function(e){
  var el=e.target,k=el.dataset.k;if(!DRAFT||!(k==="start"||(k&&k.indexOf("tp.")===0)))return;var v=el.value;
  var old=timing(DRAFT);
  if(k==="start"){if(tmin(v)===null)return;var ss=DRAFT.settings.starts=DRAFT.settings.starts||{};(ss[el.dataset.day]=ss[el.dataset.day]||{})[el.dataset.hall]=v;
    slotGroups(DRAFT).forEach(function(g){if(!(ss[g.day]&&tmin(ss[g.day][g.hall])!==null)){(ss[g.day]=ss[g.day]||{})[g.hall]=startOf(DRAFT,g.day,g.hall,g.ms)}})}
  else{var n=parseNum(v);if(n===null||n<(k==="tp.pause"?0:1)){render(true);return}
    if(k==="tp.dur"){var cc=compById(el.dataset.id,DRAFT);if(!cc)return;cc.dur=Math.round(n)}else DRAFT.settings.pause=Math.round(n)}
  reflow(DRAFT,old);clearCache();markDirty();render(true);toast("Alle Spielzeiten angepasst. Zum Übernehmen veröffentlichen.")});

/* Turnierkonzept-Felder: Texte ohne Neuaufbau, Auswahlfelder sofort, Datum/Zeit nach Eingabe */
function cnInput(el,k,id,v){var cn=DRAFT.concept,f;
  if(k.indexOf("cn.day.")===0){cn.days[+el.dataset.i][k.slice(7)]=v;return false}
  if(k==="cn.flast"){cn.flast=!!v;markDirty();render(true);return true}
  if(k==="cn.hall.name"){var hh=cn.halls.find(function(h){return h.id===id});if(hh)hh.name=v;return false}
  if(k.indexOf("cn.c.")===0){var c=cn.comps.find(function(x){return x.id===id});if(!c)return true;f=k.slice(5);
    if(f==="name"){c.name=v;return false}
    if(f==="code"){c.code=String(v).replace(/[^A-Za-z0-9]/g,"").toUpperCase();return false}
    if(f==="third"||f==="places")c[f]=!!v;else if(f==="rr")c.rr=+v;else c[f]=v;
    markDirty();render(true);return true}
  return false}
app.addEventListener("change",function(e){var el=e.target,k=el.dataset.k;if(!DRAFT||!k)return;
  if(k.indexOf("cn.day.")===0||k.indexOf("col.")===0||k==="cn.hall.name"||k==="cn.c.name"||k==="cn.c.code")render(true)});
/* Logos: quadratisch, einheitliche Größe */
function encodeLogo(img,N){
  var cv=document.createElement("canvas");cv.width=N;cv.height=N;var c=cv.getContext("2d");
  c.fillStyle="#fff";c.fillRect(0,0,N,N);
  var sc=Math.min(N/img.width,N/img.height),w=img.width*sc,h=img.height*sc;
  c.drawImage(img,(N-w)/2,(N-h)/2,w,h);
  var out=cv.toDataURL("image/webp",.86);
  if(out.indexOf("data:image/webp")!==0)out=cv.toDataURL("image/jpeg",.85);
  return out}
function processLogo(file,N){return new Promise(function(res,rej){
  if(!/^image\/(png|jpeg)$/.test(file.type)){rej(new Error("type"));return}
  var r=new FileReader();r.onerror=rej;r.onload=function(){var img=new Image();img.onerror=rej;img.onload=function(){res(encodeLogo(img,N))};img.src=r.result};r.readAsDataURL(file)})}
/* Bereits gespeicherte große Logos (z. B. PNG aus Safari) nachträglich verkleinern */
function shrinkLogo(url,N){return new Promise(function(res){
  if(!url||url.length<30000){res(url);return}
  var img=new Image();img.onerror=function(){res(url)};img.onload=function(){var o=encodeLogo(img,N);res(o.length<url.length?o:url)};img.src=url})}
async function shrinkAll(st){
  for(var i=0;i<st.teams.length;i++){var t=st.teams[i];if(t.logo)t.logo=await shrinkLogo(t.logo,160)}
  if(st.clubLogo)st.clubLogo=await shrinkLogo(st.clubLogo,320)}
app.addEventListener("change",async function(e){
  var el=e.target;if(!el.files||!el.files[0])return;
  try{
    if(el.dataset.logo){var url=await processLogo(el.files[0],160);DRAFT.teams.find(function(t){return t.id===el.dataset.logo}).logo=url;toast("Logo übernommen. Zum Anzeigen veröffentlichen.")}
    else if(el.dataset.clublogo){DRAFT.clubLogo=await processLogo(el.files[0],320);toast("Vereinslogo übernommen. Zum Anzeigen veröffentlichen.")}
    else return;
    markDirty();render(true)}
  catch(err){toast("Bitte eine PNG- oder JPG-Datei wählen.")}
});

/* ---------- Ergebnis je Spiel sofort speichern ---------- */
var SAVING={};
var RES=["hs","as","hp","ap","home","away","goals","clk"];
function resKey(m){return m?RES.map(function(f){var v=m[f];return v==null?"":typeof v==="object"?JSON.stringify(v):String(v)}).join("|"):""}
function resState(m){var o=STATE&&STATE.matches.find(function(x){return x.id===m.id});
  if(SAVING[m.id])return["Wird gespeichert …",""];
  if(resKey(o)!==resKey(m))return["Nicht gespeichert","dirty"];
  return hasScore(m)?["Gespeichert und online",""]:["Noch kein Ergebnis",""]}
function saveRow(m){var st=resState(m);
  return '<div class="row" style="margin-top:10px"><span class="grow st'+(st[1]?" "+st[1]:"")+'" id="ms-'+m.id+'" style="font-size:.85rem;color:var(--muted)">'+esc(st[0])+'</span>'+
    armBtn("clearM",m.id,"Leeren","Wirklich leeren?","ghost sm")+'<button class="btn blue sm" data-act="saveM" data-id="'+m.id+'"'+(SAVING[m.id]?" disabled":"")+'>Speichern</button></div>'}
function updRes(id){var m=findM(id),el=document.getElementById("ms-"+id);if(!m||!el)return;var st=resState(m);el.textContent=st[0];el.className="grow st"+(st[1]?" "+st[1]:"")}
async function saveMatch(id,clear){
  if(!FB){toast("Firebase ist noch nicht eingerichtet (firebase-config.js).");return}
  var m=findM(id);if(!m||SAVING[id])return;
  if(clear){["hs","as","hp","ap","goals","clk"].forEach(function(f){m[f]=null})}
  else if(num(m.hs)!==num(m.as)){toast("Bitte beide Tore eintragen (0 ist erlaubt).");return}
  else syncGoals(m);
  var vals={};RES.forEach(function(f){vals[f]=m[f]==null?null:clone(m[f])});
  SAVING[id]=true;render(true);
  try{
    var saved=await runTransaction(FB.db,async function(tx){
      var snap=await tx.get(FB.ref);
      var cur=snap.exists()?norm(JSON.parse(snap.data().json)):clone(STATE);
      var rm=cur.matches.find(function(x){return x.id===id});
      if(!rm){var e=new Error("missing");e.code="missing";throw e}
      RES.forEach(function(f){rm[f]=vals[f]});
      cur.updated=new Date().toISOString();
      tx.set(FB.ref,{json:JSON.stringify(cur),updated:cur.updated});
      return cur});
    STATE=norm(saved);
    /* übrige, noch nicht veröffentlichte Änderungen im Entwurf behalten */
    var dm=findM(id);RES.forEach(function(f){dm[f]=vals[f]});
    saveDraft();clearCache();toast(clear?"Ergebnis geleert und online":"Ergebnis gespeichert und online");
  }catch(err){var c=err&&err.code;
    toast(c==="permission-denied"?"Keine Schreibrechte. Ist deine UID in den Firestore-Regeln eingetragen?":c==="missing"?"Dieses Spiel gibt es online nicht. Bitte zuerst den Spielplan veröffentlichen.":"Speichern fehlgeschlagen. Bitte Internetverbindung prüfen.")}
  delete SAVING[id];markDirty();render(true)}
function askSure(what){var v=prompt(what+"\n\nZum Bestätigen bitte LÖSCHEN eintippen:");return v!==null&&v.trim().toUpperCase()==="LÖSCHEN"}
function backup(){var s=STATE||DRAFT;if(!s)return;var b=new Blob([JSON.stringify(s,null,1)],{type:"application/json"}),a=document.createElement("a");
  a.href=URL.createObjectURL(b);a.download=slug(fullTitle())+"-sicherung-"+new Date().toISOString().slice(0,10)+".json";document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1000);toast("Sicherung heruntergeladen")}
function clearResults(st){st.matches.forEach(function(m){["hs","as","hp","ap","goals","clk"].forEach(function(f){m[f]=null});if(m.hsrc)m.home="";if(m.asrc)m.away=""})}
async function resetResults(){
  if(!FB){toast("Firebase ist noch nicht eingerichtet (firebase-config.js).");return}
  if(!askSure("Alle Ergebnisse dieses Turniers löschen? Das kann nicht rückgängig gemacht werden (außer über eine Sicherung)."))return;
  try{
    var saved=await runTransaction(FB.db,async function(tx){
      var snap=await tx.get(FB.ref);
      var cur=snap.exists()?norm(JSON.parse(snap.data().json)):clone(STATE);
      clearResults(cur);cur.updated=new Date().toISOString();
      tx.set(FB.ref,{json:JSON.stringify(cur),updated:cur.updated});return cur});
    STATE=norm(saved);if(DRAFT){clearResults(DRAFT)}saveDraft();clearCache();toast("Alle Ergebnisse gelöscht");render(true);
  }catch(err){toast(err&&err.code==="permission-denied"?"Keine Schreibrechte. Ist deine UID in den Firestore-Regeln eingetragen?":"Löschen fehlgeschlagen. Bitte Internetverbindung prüfen.")}
}
/* ---------- Veröffentlichen (Firestore) ---------- */
async function publish(){
  if(publishing)return;
  if(!FB){toast("Firebase ist noch nicht eingerichtet (firebase-config.js).");return}
  var next=clone(DRAFT);next.updated=new Date().toISOString();
  var json=JSON.stringify(next);
  if(json.length>700000){await shrinkAll(next);await shrinkAll(DRAFT);json=JSON.stringify(next)}
  if(json.length>950000){toast("Zu viele Daten, meist zu viele große Logos. Bitte einzelne Logos entfernen.");return}
  publishing=true;markDirty();
  var base=STATE.updated||null;
  try{
    await runTransaction(FB.db,async function(tx){
      var snap=await tx.get(FB.ref);
      if(snap.exists()&&(snap.data().updated||null)!==base){var e=new Error("conflict");e.code="conflict";throw e}
      tx.set(FB.ref,{json:json,updated:next.updated});
    });
    lsSet("nt-draft",null);STATE=next;DRAFT=clone(STATE);publishing=false;toast("Veröffentlicht");render(true);
  }catch(err){publishing=false;markDirty();var c=err&&err.code;
    toast(c==="conflict"?"Inzwischen wurde von einem anderen Gerät veröffentlicht. Bitte „Verwerfen“ tippen und die Änderung erneut eintragen.":
      c==="permission-denied"?"Keine Schreibrechte. Ist deine UID in den Firestore-Regeln eingetragen?":"Veröffentlichen fehlgeschlagen. Bitte Internetverbindung prüfen.")}
}
function swapIn(arr,i,d){var j=i+d;if(i<0||j<0||j>=arr.length)return;var x=arr[i];arr[i]=arr[j];arr[j]=x}
function arm(key){clearTimeout(armTimer);if(armed===key){armed=null;return true}armed=key;armTimer=setTimeout(function(){armed=null;render(true)},4000);render(true);return false}

app.addEventListener("click",function(e){
  var t=e.target.closest("[data-go],[data-filter],[data-atab],[data-afilter],[data-tcat],[data-act],[data-team],[data-shday]");if(!t)return;if(t.tagName==="INPUT")return;
  if(t.dataset.shday){shDay=t.dataset.shday;render(true);return}
  if(t.dataset.go){go(t.dataset.go);return}
  if(t.dataset.team){filter="team:"+t.dataset.team;go("plan");return}
  if(t.dataset.filter){filter=t.dataset.filter;saveResume();render(true);return}
  if(t.dataset.tcat){tcat=t.dataset.tcat;saveResume();render(true);return}
  if(t.dataset.atab){atab=t.dataset.atab;saveResume();render(false);window.scrollTo(0,0);return}
  if(t.dataset.afilter){afilter=t.dataset.afilter;saveResume();render(true);return}
  var a=t.dataset.act,id=t.dataset.id;
  if(a==="logout"){if(FB)signOut(FB.auth);DRAFT=null;go("home");return}
  if(a==="publish"){publish();return}
  if(a==="saveM"){saveMatch(id,false);return}
  if(a==="clearM"){if(!arm("clearM:"+id))return;saveMatch(id,true);return}
  if(/^clk|^goal[HA]$|^gDel$/.test(a)){var cm=findM(id);if(!cm)return;var now=Date.now(),cc=cm.clk||{};
    if(a==="clkStart"){cm.clk={st:"run",t0:now,acc:0};if(!num(cm.hs))cm.hs=0;if(!num(cm.as))cm.as=0;
      /* Stand vor dem Anpfiff (falls schon etwas eingetragen war) ohne Minute übernehmen */
      cm.goals=[];for(var gi=0;gi<+cm.hs;gi++)cm.goals.push({s:"h",min:null});for(gi=0;gi<+cm.as;gi++)cm.goals.push({s:"a",min:null})}
    else if(a==="clkPause"){if(cc.st!=="run")return;cm.clk={st:"pause",t0:null,acc:clkElapsed(cm)}}
    else if(a==="clkResume"){cm.clk={st:"run",t0:now,acc:clkElapsed(cm)}}
    else if(a==="clkEnd"){if(!arm("clkEnd:"+id))return;cm.clk={st:"end",t0:null,acc:clkElapsed(cm)}}
    else if(a==="clkReset"){if(!arm("clkReset:"+id))return;cm.clk=null}
    else if(a==="goalH"||a==="goalA"){var f=a==="goalH"?"hs":"as";cm[f]=(num(cm[f])?+cm[f]:0)+1}
    else if(a==="gDel"){var gx=cm.goals&&cm.goals[+t.dataset.i];if(!gx)return;cm.goals.splice(+t.dataset.i,1);var gf=gx.s==="h"?"hs":"as";cm[gf]=Math.max(0,(+cm[gf]||0)-1);markDirty();render(true);return}
    saveMatch(id,false);return}
  if(a==="backup"){backup();return}
  if(a==="resetResults"){resetResults();return}
  if(a==="loadPlan"){if(!arm("loadPlan:"))return;loadPlan();return}
  if(a==="cnGen"){if(!arm("cnGen:"))return;applyGenerate();return}
  if(a==="reset"){if(!arm("reset:"))return;DRAFT=clone(STATE);saveDraft();render(true);toast("Änderungen verworfen");return}
  if(a==="shLock"){lsSet("nt-shifts",null);render(false);return}
  if(a==="shOff"){var sp=id.split("|"),sar=DRAFT.shiftAreas.find(function(x){return x.id===sp[1]}),has=false;
    if(sar)for(var si=0;si<sar.n;si++){if((DRAFT.shifts[id+"|"+si]||"").trim())has=true}
    if(has&&!arm("shOff:"+id))return;
    Object.keys(DRAFT.shifts).forEach(function(key){if(key.indexOf(id+"|")===0)delete DRAFT.shifts[key]});DRAFT.shiftsOff[id]=true}
  else if(a==="shOn"){delete DRAFT.shiftsOff[id]}
  else if(a==="saAdd"){DRAFT.shiftAreas.push({id:uid("a"),name:"Neuer Bereich",n:1})}
  else if(a==="saDel"){if(!arm("saDel:"+id))return;DRAFT.shiftAreas=DRAFT.shiftAreas.filter(function(x){return x.id!==id});
    Object.keys(DRAFT.shifts).forEach(function(key){if(key.split("|")[1]===id)delete DRAFT.shifts[key]});
    Object.keys(DRAFT.shiftsOff).forEach(function(key){if(key.split("|")[1]===id)delete DRAFT.shiftsOff[key]})}
  else if(a==="saUp"||a==="saDown"){swapIn(DRAFT.shiftAreas,DRAFT.shiftAreas.findIndex(function(x){return x.id===id}),a==="saUp"?-1:1)}
  else if(a==="colPreset"){DRAFT.settings.colors={primary:t.dataset.p,on:t.dataset.o}}
  else if(a==="colReset"){DRAFT.settings.colors=clone(DEFAULT_COLORS)}
  else if(a==="cnTeams"){var ct=DRAFT.concept.comps.find(function(x){return x.id===id});ct.teams=Math.max(2,Math.min(24,+t.dataset.n||ct.teams))}
  else if(a==="cnGroups"){DRAFT.concept.comps.find(function(x){return x.id===id}).groups=+t.dataset.n===1?1:2}
  else if(a==="cnCompAdd"){var cs=DRAFT.concept.comps,usedC={};cs.forEach(function(x){usedC[String(x.code).toUpperCase()]=1});var nl="KJMNLUVXY".split("").find(function(l){return !usedC[l]})||"Z";
    cs.push({id:uid("k"),name:"Neuer Wettbewerb",code:nl,hall:DRAFT.concept.halls[DRAFT.concept.halls.length-1].id,teams:8,groups:2,rr:1,mode:"semis",third:true,places:true,dur:20})}
  else if(a==="cnCompDel"){if(!arm("cnCompDel:"+id))return;DRAFT.concept.comps=DRAFT.concept.comps.filter(function(x){return x.id!==id})}
  else if(a==="cnHallAdd"){DRAFT.concept.halls.push({id:uid("h"),name:"Halle "+(DRAFT.concept.halls.length+1)})}
  else if(a==="cnHallDel"){if(!arm("cnHallDel:"+id))return;var hs=DRAFT.concept.halls=DRAFT.concept.halls.filter(function(x){return x.id!==id});
    DRAFT.concept.comps.forEach(function(x){if(x.hall===id)x.hall=hs[0].id})}
  else if(a==="cnDayAdd"){var dl=DRAFT.concept.days,ld=dl.length?dl[dl.length-1].d:isoToday(),pp=ld.split("-"),nd=new Date(+pp[0],pp[1]-1,+pp[2]+1);
    dl.push({d:nd.getFullYear()+"-"+String(nd.getMonth()+1).padStart(2,"0")+"-"+String(nd.getDate()).padStart(2,"0"),start:"09:30",end:"19:00"})}
  else if(a==="cnDayDel"){DRAFT.concept.days.splice(+t.dataset.i,1)}
  else if(a==="faAdd"){DRAFT.foodAreas.push({id:uid("f"),name:"Neue Theke",text:""})}
  else if(a==="faDel"){if(!arm("faDel:"+id))return;DRAFT.foodAreas=DRAFT.foodAreas.filter(function(x){return x.id!==id});DRAFT.menu=DRAFT.menu.filter(function(c){return c.area!==id})}
  else if(a==="faUp"||a==="faDown"){swapIn(DRAFT.foodAreas,DRAFT.foodAreas.findIndex(function(x){return x.id===id}),a==="faUp"?-1:1)}
  else if(a==="delLogo"){DRAFT.teams.find(function(x){return x.id===id}).logo=""}
  else if(a==="addInfo"){DRAFT.info.push({id:uid("n"),title:"Neuer Abschnitt",text:""})}
  else if(a==="delInfo"){if(!arm("delInfo:"+id))return;DRAFT.info=DRAFT.info.filter(function(x){return x.id!==id})}
  else if(a==="infoUp"||a==="infoDown"){swapIn(DRAFT.info,DRAFT.info.findIndex(function(x){return x.id===id}),a==="infoUp"?-1:1)}
  else if(a==="catUp"||a==="catDown"){var cc=findC(id),same=DRAFT.menu.map(function(c,k){return c.area===cc.area?k:-1}).filter(function(k){return k>=0}),p=same.indexOf(DRAFT.menu.indexOf(cc)),q=p+(a==="catUp"?-1:1);
    if(q>=0&&q<same.length){var t1=DRAFT.menu[same[p]];DRAFT.menu[same[p]]=DRAFT.menu[same[q]];DRAFT.menu[same[q]]=t1}}
  else if(a==="itemUp"||a==="itemDown"){var ic=findC(t.dataset.cid);swapIn(ic.items,ic.items.findIndex(function(x){return x.id===id}),a==="itemUp"?-1:1)}
  else if(a==="addCat"){DRAFT.menu.push({id:uid("c"),name:"Neue Kategorie",area:t.dataset.area,items:[]})}
  else if(a==="delCat"){if(!arm("delCat:"+id))return;DRAFT.menu=DRAFT.menu.filter(function(c){return c.id!==id})}
  else if(a==="addItem"){findC(id).items.push({id:uid("i"),name:"Neues Angebot",price:0,note:"",out:false,hide:false})}
  else if(a==="delItem"){var c=findC(t.dataset.cid);c.items=c.items.filter(function(i){return i.id!==id})}
  else return;
  markDirty();render(true);
});
app.addEventListener("keydown",function(e){if((e.key==="Enter"||e.key===" ")&&e.target.matches("img[data-go]")){e.preventDefault();go(e.target.dataset.go)}});
app.addEventListener("submit",function(e){
  if(e.target.id!=="shf")return;e.preventDefault();
  var v=document.getElementById("shpw").value.trim();
  if(v===STATE.shiftPw){lsSet("nt-shifts",STATE.shiftPw);render(false)}else{document.getElementById("sherr").textContent="Das Passwort stimmt nicht."}
});

/* ---------- Start ---------- */
setInterval(function(){if((route==="plan"||route==="home"))render(true)},20000);
/* Spielminute alle 5 Sekunden aktualisieren, ohne Eingaben im Orga-Bereich zu stören */
setInterval(function(){document.querySelectorAll("[data-clk]").forEach(function(el){var st=DRAFT||STATE;if(!st)return;var m=st.matches.find(function(x){return x.id===el.dataset.clk}),li=m&&liveInfo(m);if(li){var t=minTxt(li);if(el.textContent!==t)el.textContent=t}})},5000);
window.addEventListener("pagehide",saveResume);
var res=lsGet("nt-resume");
if(res&&Date.now()-res.t<90e3){route=res.route||"home";atab=res.atab||atab;afilter=res.afilter||afilter;filter=res.filter||"Alle";tcat=res.tcat||tcat}
if(location.hash==="#schichten")route="shifts";
render(false);

function applyRemote(s){
  var dirty=isDirty(),prev=STATE;STATE=norm(s);
  if(route==="admin"&&DRAFT){
    if(dirty){var pm={};(prev?prev.matches:[]).forEach(function(x){pm[x.id]=x});
      STATE.matches.forEach(function(rm){var dm=DRAFT.matches.find(function(x){return x.id===rm.id});
        if(dm&&!SAVING[rm.id]&&resKey(dm)===resKey(pm[rm.id]))RES.forEach(function(f){dm[f]=rm[f]})});
      saveDraft();clearCache()}
    else DRAFT=clone(STATE)}
  render(true);
}
fetch("default-state.json",{cache:"no-cache"}).then(function(r){return r.json()}).then(function(def){if(!STATE){STATE=norm(def);render(false)}})
  .catch(function(){if(!STATE)app.innerHTML='<main><div class="wrap"><p class="empty" style="margin-top:30vh">Die Turnierdaten konnten nicht geladen werden. Bitte Seite neu laden.</p></div></main>'});
if(firebaseConfig&&firebaseConfig.apiKey&&firebaseConfig.apiKey.indexOf("HIER")!==0){
  try{
    var fbApp=initializeApp(firebaseConfig),db=getFirestore(fbApp),auth=getAuth(fbApp);
    FB={db:db,auth:auth,ref:doc(db,DATA_DOC[0],DATA_DOC[1])};
    onSnapshot(FB.ref,function(snap){if(snap.exists()){try{applyRemote(JSON.parse(snap.data().json))}catch(e){}}},function(){});
    onAuthStateChanged(auth,function(u){USER=u;if(route==="admin")render(false)});
  }catch(e){FB=null}
}
window.__nt={S:S,generate:generate,norm:norm,standings:standings,prTable:prTable,finalPlaces:finalPlaces,resolve:resolve,clearCache:clearCache,setState:function(s){STATE=norm(s);clearCache()}};
