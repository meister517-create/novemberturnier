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
var DRAFT=null,route="home",filter="Alle",tcat="Damen",atab="plan",afilter="Offen",publishing=false,armed=null,armTimer=null;
var CATS=["Damen","Herren"];
var AREAS=[["tag","Tagsüber","Essen und Getränke in der Halle, Samstag und Sonntag"],["party","Playersparty","Getränke auf der Playersparty"]];

function norm(s){s.settings=s.settings||{};s.teams=s.teams||[];s.matches=s.matches||[];s.menu=s.menu||[];s.info=s.info||[];s.menu.forEach(function(c){if(c.area!=="party")c.area="tag";c.items=c.items||[]});return s}

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
function dur(m){var st=S().settings;return Math.max(1,+(m&&m.cat==="Herren"?st.durH:st.durD)||20)}
/* ---------- Zeitplan: Starts je Tag und Halle, Spielzeit + Wechsel ---------- */
function pause(){var v=+S().settings.pause;return isNaN(v)||v<0?5:v}
function tmin(t){var p=String(t||"").split(":");return p.length<2?null:(+p[0])*60+(+p[1]||0)}
function tfmt(n){n=((Math.round(n)%1440)+1440)%1440;return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0")}
function slotGroups(st){var g={};st.matches.forEach(function(m){var d=m.day||st.settings.day||"",h=m.pitch||"";(g[d+"|"+h]=g[d+"|"+h]||{day:d,hall:h,ms:[]}).ms.push(m)});
  return Object.keys(g).sort().map(function(k){var x=g[k];x.ms.sort(function(a,b){return (tmin(a.time)||0)-(tmin(b.time)||0)||String(a.id).localeCompare(String(b.id),"de",{numeric:true})});return x})}
function startOf(st,day,hall,ms){var s=(st.settings.starts||{})[day];var v=s&&s[hall];if(tmin(v)!==null)return v;var f=ms&&ms[0]&&ms[0].time;return tmin(f)!==null?f:"09:00"}
function durOf(st,m){return Math.max(1,+(m.cat==="Herren"?st.settings.durH:st.settings.durD)||20)}
function reflow(st,old){old=old||st.settings;var p=+st.settings.pause,op=+old.pause;if(isNaN(p)||p<0)p=5;if(isNaN(op)||op<0)op=5;
  var od=function(m){return Math.max(1,+(m.cat==="Herren"?old.durH:old.durD)||20)};
  /* Pausen, die im Plan bewusst eingebaut sind (z. B. Mittag, vor Finals), bleiben erhalten */
  slotGroups(st).forEach(function(g){var gaps=g.ms.map(function(m,i){if(!i)return 0;var pr=g.ms[i-1],x=tmin(m.time)-(tmin(pr.time)+od(pr)+op);return x>0?x:0});
    var t=tmin(startOf(st,g.day,g.hall,g.ms));g.ms.forEach(function(m,i){t+=gaps[i];m.time=tfmt(t);t+=durOf(st,m)+p})})}
function matchStart(m){var d=mday(m);if(!d||!m.time)return null;var p=d.split("-"),h=m.time.split(":");return new Date(+p[0],p[1]-1,+p[2],+h[0],+h[1]||0).getTime()}
function liveInfo(m){if(hasScore(m))return null;var s=matchStart(m);if(s===null)return null;var n=Date.now(),D=dur(m)*60e3;if(n<s||n>=s+D)return null;return{min:Math.floor((n-s)/60e3)+1,p:(n-s)/D}}
function liveMatches(){return sortedMatches().filter(function(m){return liveInfo(m)})}
function nextMatch(){return sortedMatches().find(function(m){return !hasScore(m)&&!liveInfo(m)})}
function fmtDay(d,o){if(!d)return"";var p=d.split("-");return new Date(+p[0],p[1]-1,+p[2]).toLocaleDateString("de-DE",o||{weekday:"long",day:"numeric",month:"long"})}
function multiDay(){var s={};S().matches.forEach(function(m){s[mday(m)]=1});return Object.keys(s).length>1}
function hall(m){return m.pitch?"Halle "+m.pitch:""}
function groupsOf(cat){var g=[];S().teams.forEach(function(t){if(t.group&&t.group.indexOf(cat)===0&&g.indexOf(t.group)<0)g.push(t.group)});return g.sort()}
function allGroups(){return groupsOf("Damen").concat(groupsOf("Herren"))}
function shortG(g){return String(g).replace(/^(Damen|Herren)\s+/,"Gruppe ")}
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
function groupDone(g){var ms=S().matches.filter(function(m){return m.group===g});return ms.length>0&&ms.every(hasScore)}
function winnerSide(m){if(!hasScore(m))return null;var hs=+m.hs,as=+m.as;if(hs>as)return"home";if(as>hs)return"away";
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
  var ko=S().matches.filter(function(m){return m.cat===cat&&placeBase(m)>0}).sort(function(a,b){return placeBase(a)-placeBase(b)});
  var out=[];
  ko.forEach(function(m){var lbl=m.round,w=winnerSide(m);
    [true,false].forEach(function(win){
      if(!w)out.push({l:(win?"Sieger ":"Verlierer ")+lbl});
      else out.push({t:resolve(m,win?w:(w==="home"?"away":"home"))})})});
  var pr=prTable(cat);
  for(var i=0;i<pr.n;i++)out.push(pr.done&&pr.rows[i]?{t:pr.rows[i].t}:{l:(i+1)+". der Platzierungsrunde"});
  return out;
}

/* ---------- Symbole & Navigation ---------- */
var ICON={
 home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
 plan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7"/></svg>',
 teams:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
 table:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V10h5v11M9 21V4h6v17M15 21v-8h5v8M2 21h20"/></svg>',
 food:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v8a3 3 0 0 0 6 0V2M9 2v20M17 2c-2 2-3 5-3 8h4v12"/></svg>'
};
var NAV=[["home","Start"],["plan","Spielplan"],["teams","Teams"],["table","Tabelle"]];
function nav(){return '<nav class="bn" aria-label="Hauptnavigation"><div class="wrap">'+NAV.map(function(p){
  return '<button data-go="'+p[0]+'"'+(route===p[0]?' aria-current="page"':'')+'>'+ICON[p[0]]+'<span>'+p[1]+'</span></button>'}).join("")+'</div></nav>'}
function pageHead(t){return '<div class="ph"><div class="wrap"><img src="'+curLogo()+'" alt="Zur Startseite" role="button" tabindex="0" data-go="home"><h1>'+t+'</h1></div></div>'}

/* ---------- Ansichten ---------- */
/* Hallenhockey-Spielfeld als Hintergrund: Schusskreis, 7-m-Punkt, Bande */
var COURT='<svg class="court" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#fff" stroke-width="2"><rect x="10" y="20" width="380" height="560" rx="6"/><path d="M80 20v8a120 120 0 0 0 240 0v-8"/><circle cx="200" cy="150" r="3" fill="#fff"/><path d="M170 20v-8h60v8"/><path d="M10 300h380" opacity=".6"/><circle cx="200" cy="300" r="60" opacity=".5"/></svg>';
function hero(){
  var st=S().settings,meta=[st.date,st.place].filter(Boolean).map(esc).join(" · ");
  return '<header class="hero">'+COURT+'<div class="wrap"><div class="hero-top"><img src="'+curLogo()+'" alt="Logo TSC Eintracht Dortmund"><div class="club">TSC Eintracht Dortmund<br>Hockey</div><button class="info-btn" data-go="info" aria-label="Infos zum Turnier">i</button></div>'+
   '<div class="hero-num"><span class="n" aria-hidden="true">43</span><span class="lbl">Auflage<br>des Turniers</span></div><h1>Novemberturnier</h1>'+(meta?'<p class="meta">'+meta+'</p>':'')+
   '<div class="halls"><span>Damen · Halle Ost</span><span>Herren · Halle West</span></div></div></header>';
}
function tile(k,t,body,cls){return '<button class="tile '+cls+'" data-go="'+k+'"><div class="t-head"><h2>'+t+'</h2>'+ICON[k]+'</div><div class="t-body">'+body+'</div></button>'}
function vHome(){
  var nm=nextMatch(),lv=liveMatches(),items=[].concat.apply([],S().menu.map(function(c){return c.items||[]}));
  var wd=function(m){return multiDay()?fmtDay(mday(m),{weekday:"long"})+" ":""};
  var lbl=function(m){return m.cat+(m.group?" "+shortG(m.group):" · "+m.round)};
  var plan=lv.length?'<span class="lvtag"><i></i>Live'+(lv.length>1?", "+lv.length+" Spiele":"")+'</span><span>'+liveInfo(lv[0]).min+'. Minute, '+esc(hall(lv[0]))+', '+esc(lbl(lv[0]))+'</span><strong>'+esc(sideName(lv[0],"home"))+'<span class="vs">gegen</span>'+esc(sideName(lv[0],"away"))+'</strong>'
    :nm?'<span>Als Nächstes '+esc(wd(nm))+'um '+esc(nm.time)+' Uhr, '+esc(hall(nm))+', '+esc(lbl(nm))+'</span><strong>'+esc(sideName(nm,"home"))+'<span class="vs">gegen</span>'+esc(sideName(nm,"away"))+'</strong>'
    :(S().matches.length?'<strong>Alle Spiele sind gespielt</strong>':'<strong>Der Spielplan folgt</strong>');
  var champs=CATS.map(function(c){var f=finalPlaces(c)[0];return f&&f.t?c+": "+f.t.name:""}).filter(Boolean);
  var leaders=allGroups().map(function(g){var s=standings(g);return s.length&&s[0].sp?g+": "+s[0].t.name:""}).filter(Boolean);
  var tbl=champs.length?'<strong>Turniersieg</strong><span>'+champs.map(esc).join("<br>")+'</span>'
    :leaders.length?'<strong>'+esc(leaders[0])+'</strong><span>'+leaders.slice(1).map(esc).join("<br>")+'</span>':'<strong>Noch keine Ergebnisse</strong><span>4 Gruppen, Damen und Herren</span>';
  var ch=items.filter(function(i){return !i.out}).sort(function(a,b){return a.price-b.price})[0];
  var food=items.length?'<strong>'+items.length+' Angebote</strong><span>'+(ch?"ab "+eur(ch.price):"")+'</span>':'<strong>Karte folgt</strong><span>Speisen und Getränke</span>';
  var tm=S().teams,nd=tm.filter(function(t){return /^Damen/.test(t.group)}).length;
  var teams='<div class="lgs">'+tm.slice(0,12).map(function(t){return logo(t)}).join("")+'</div><strong>'+tm.length+' Teams</strong><span>'+nd+' Damenteams, '+(tm.length-nd)+' Herrenteams</span>';
  return hero()+'<main><div class="wrap"><div class="tiles">'+tile("plan","Spielplan",plan,"big")+tile("table","Tabelle",tbl,"")+tile("teams","Teams",teams,"")+
   '</div><p class="foot">43. Novemberturnier des TSC Eintracht Dortmund<br><button data-go="admin">Orga-Bereich</button></p></div></main>'+nav();
}
function midLabel(m){return '<b>'+esc(m.cat)+' · '+esc(m.id)+'</b>'+esc(m.group?shortG(m.group):m.round)}
function gameHTML(m,nx){
  var sc=hasScore(m),hs=+m.hs,as=+m.as,t1=resolve(m,"home"),t2=resolve(m,"away"),lv=liveInfo(m),w=winnerSide(m);
  var so=sc&&hs===as&&isKO(m)&&num(m.hp)&&num(m.ap)?'<div class="so">n. 7m '+(+m.hp)+':'+(+m.ap)+'</div>':'';
  var mid='<div class="mid">'+(lv?'<span class="pill lv"><i></i>LIVE</span>':nx?'<span class="pill">Als Nächstes</span>':'')+'<div class="grp">'+midLabel(m)+'</div>'+
    (lv?'<div class="min">'+lv.min+'. Min.</div><div class="prog" aria-hidden="true"><b style="--p:'+(lv.p*100).toFixed(1)+'%"></b></div><div class="small">seit '+esc(m.time)+' Uhr, '+esc(hall(m))+'</div>'
    :sc?'<div class="score">'+hs+':'+as+'</div>'+so+'<div class="small">'+esc(m.time)+' Uhr, '+esc(hall(m))+'</div>'
       :'<div class="vs">vs.</div><div class="clock">'+esc(m.time)+'</div><div class="small">'+esc(hall(m))+'</div>')+'</div>';
  function side(t,s,won){return '<div class="side">'+logo(t,56)+'<span class="nm'+(t?'':' ph-t')+(won?' won':'')+'">'+esc(s)+'</span></div>'}
  return '<div class="game'+(lv?' live':nx?' next':'')+'">'+side(t1,sideName(m,"home"),t1&&w==="home")+mid+side(t2,sideName(m,"away"),t2&&w==="away")+'</div>';
}
function vPlan(){
  var opts=["Alle","Damen","Herren","Halle Ost","Halle West","Finalrunde"];
  var teamF=filter.indexOf("team:")===0?teamById(filter.slice(5)):null;
  if(!teamF&&opts.indexOf(filter)<0)filter="Alle";
  var nm=nextMatch();
  var ms=sortedMatches().filter(function(m){
    if(teamF)return involves(m,teamF.id);
    if(filter==="Alle")return true;if(filter==="Finalrunde")return !m.group;
    if(filter.indexOf("Halle")===0)return hall(m)===filter;return m.cat===filter});
  var chips=(teamF?'<button class="chip" data-filter="Alle" aria-pressed="true">'+esc(teamF.name)+' ✕</button>':'')+opts.map(function(o){return '<button class="chip" data-filter="'+esc(o)+'" aria-pressed="'+(!teamF&&o===filter)+'">'+esc(o)+'</button>'}).join("");
  var md=multiDay(),cur=null;var body=ms.length?'<div class="games">'+ms.map(function(m){var h="";if(md&&mday(m)!==cur){cur=mday(m);h='<h2 class="dayh">'+esc(fmtDay(cur))+'</h2>'}return h+gameHTML(m,nm&&nm.id===m.id)}).join("")+'</div>':'<div class="empty">In dieser Auswahl gibt es keine Spiele.</div>';
  return pageHead("Spielplan")+'<main><div class="wrap"><div class="chips" role="group" aria-label="Filter">'+chips+'</div>'+body+'</div></main>'+nav();
}
function vTeams(){
  var tm=S().teams;
  function grid(list){return '<div class="tgrid">'+list.map(function(t){return '<button class="tcard" data-team="'+t.id+'">'+logo(t,84)+'<span class="nm">'+esc(t.name)+'</span></button>'}).join("")+'</div>'}
  var body=tm.length?allGroups().map(function(g){return '<h2 class="sec">'+esc(g)+'</h2>'+grid(tm.filter(function(t){return t.group===g}))}).join(""):'<div class="empty">Die Teams werden bald bekannt gegeben.</div>';
  return pageHead("Teams")+'<main><div class="wrap"><p class="hint" style="margin-top:0">Tippe auf ein Team, um seine Spiele zu sehen.</p>'+body+'</div></main>'+nav();
}
function tableHTML(rows,startAt,missing){
  return '<div class="tbl-wrap"><table><thead><tr><th>#</th><th class="team">Team</th><th>Sp</th><th class="sun">S</th><th class="sun">U</th><th class="sun">N</th><th>Tore</th><th>Pkt</th></tr></thead><tbody>'+
    rows.map(function(r,i){return '<tr class="'+(i===0&&r.sp?"lead":"")+'"><td class="pos">'+(i+startAt)+'</td><td class="team"><span class="tc">'+logo(r.t,28)+esc(r.t.name)+'</span></td><td>'+r.sp+'</td><td class="sun">'+r.s+'</td><td class="sun">'+r.u+'</td><td class="sun">'+r.n+'</td><td>'+r.tf+':'+r.tg+'</td><td class="pts">'+r.p+'</td></tr>'}).join("")+
    (missing||[]).map(function(sp,i){return '<tr><td class="pos">'+(rows.length+i+startAt)+'</td><td class="team"><span class="tc">'+logo(null,28)+'<span class="ph-t">'+esc(sp.p+". "+shortG(sp.g))+'</span></span></td><td>–</td><td class="sun">–</td><td class="sun">–</td><td class="sun">–</td><td>–</td><td class="pts">–</td></tr>'}).join("")+
    '</tbody></table></div>';
}
function groupNote(cat){var ms=S().matches.filter(function(m){return m.cat===cat});
  if(ms.some(function(m){return /Halbfinale/.test(m.round||"")}))return "Platz 1 und 2 spielen im Halbfinale.";
  return "Am Sonntag spielen die Gruppenplätze direkt gegeneinander: 1.–1. im Finale, 2.–2. um Platz 3 usw."}
function vTable(){
  var c=tcat,gs=groupsOf(c),pr=prTable(c),fp=finalPlaces(c);
  var chips='<div class="chips" role="group" aria-label="Wettbewerb">'+CATS.map(function(x){return '<button class="chip" data-tcat="'+x+'" aria-pressed="'+(x===c)+'">'+x+'</button>'}).join("")+'</div>';
  var body=gs.map(function(g){var s=standings(g),ms=S().matches.filter(function(m){return m.group===g});
    return '<h2 class="sec">'+esc(shortG(g))+'</h2>'+tableHTML(s,1)+'<p class="sub">'+(groupDone(g)?'Gruppe abgeschlossen.':ms.filter(hasScore).length+' von '+ms.length+' Spielen gespielt.')+' '+groupNote(c)+'</p>'}).join("");
  if(pr.n)body+='<h2 class="sec">Platzierungsrunde · Plätze 5 bis '+(4+pr.n)+'</h2>'+tableHTML(pr.rows,5,pr.missing)+'<p class="sub">Die Gruppendritten bis -letzten spielen je zwei Spiele gegen Teams der anderen Gruppe. '+pr.played+' von '+pr.count+' Spielen gespielt. Bei Gleichstand zählt zuletzt die bessere Gruppenplatzierung.</p>';
  body+='<h2 class="sec">Endplatzierung</h2><div class="podium">'+fp.map(function(x,i){return '<div class="place p'+(i+1)+'"><span class="rk">'+(i+1)+'</span>'+logo(x.t||null,30)+(x.t?'<b>'+esc(x.t.name)+'</b>':'<b class="ph-t">'+esc(x.l)+'</b>')+'</div>'}).join("")+'</div>';
  return pageHead("Tabelle")+'<main><div class="wrap">'+chips+body+'<p class="hint">Sieg 3 Punkte, Unentschieden 1 Punkt. Bei Gleichstand zählen Tordifferenz, erzielte Tore und der direkte Vergleich. Halbfinale, Platzierungsspiele und Finale werden bei Unentschieden per 7-m-Schießen entschieden.</p></div></main>'+nav();
}
function catHTML(c){
  return '<section class="cat"><h2 class="sec">'+esc(c.name)+'</h2>'+((c.items||[]).length?c.items.map(function(i){
    return '<div class="item'+(i.out?" out":"")+'"><span class="nm">'+esc(i.name)+'</span><span class="pr">'+eur(i.price)+'</span>'+((i.note||i.out)?'<span class="nt">'+esc(i.note)+(i.out?(i.note?" ":"")+'<span class="soldout">ausverkauft</span>':'')+'</span>':'')+'</div>'}).join(""):'<p class="hint">Noch keine Einträge.</p>')+'</section>'}
function vFood(){
  var body=AREAS.map(function(a){var cats=S().menu.filter(function(c){return c.area===a[0]});
    return '<div class="area"><h2>'+esc(a[1])+'</h2><p>'+esc(a[2])+'</p></div>'+(cats.length?cats.map(catHTML).join(""):'<div class="empty" style="margin-bottom:26px">Die Karte folgt.</div>')}).join("");
  return pageHead("Essen & Getränke")+'<main><div class="wrap">'+body+'</div></main>'+nav();
}

function vInfo(){
  var body=S().info.length?S().info.map(function(x){return '<section class="isec"><h2>'+esc(x.title)+'</h2><p>'+esc(x.text)+'</p></section>'}).join(""):'<div class="empty">Hier stehen bald alle Infos zum Turnier.</div>';
  return '<div class="ph"><div class="wrap"><img src="'+curLogo()+'" alt="Zur Startseite" role="button" tabindex="0" data-go="home"><h1>Infos</h1><button class="close-btn" data-go="home" aria-label="Infos schließen">✕</button></div></div>'+
   '<main><div class="wrap">'+body+'<button class="btn blue" data-go="home" style="width:100%;margin-top:8px">Zurück zur Startseite</button></div></main>'+nav();
}

/* ---------- Orga ---------- */
function vLogin(){
  return '<main><div class="login"><img src="'+curLogo()+'" alt=""><h1>Orga-Bereich</h1><p>Anmelden, um das Novemberturnier zu pflegen.</p>'+
  '<form id="lf" autocomplete="on"><label class="f" for="lu">E-Mail</label><input class="in" id="lu" type="email" autocomplete="username" autocapitalize="none" required>'+
  '<label class="f" for="lp">Passwort</label><input class="in" id="lp" type="password" autocomplete="current-password" required>'+
  '<button class="btn blue" style="width:100%;margin-top:18px" type="submit">Anmelden</button><div class="err" id="lerr" role="alert"></div></form>'+
  '<p style="margin-top:18px"><button class="btn ghost sm" data-go="home">Zur Startseite</button></p></div></main>';
}
var ATABS=[["plan","Ergebnisse"],["info","Infos"],["teams","Teams"],["general","Allgemein"]];
function opt(v,l,sel){return '<option value="'+esc(v)+'"'+(v===sel?" selected":"")+'>'+esc(l)+'</option>'}
function armBtn(act,id,label,armedLabel,cls){var on=armed===act+":"+(id||"");return '<button class="btn '+(cls||"icon sm")+(on?" armed":"")+'" data-act="'+act+'"'+(id?' data-id="'+id+'"':'')+'>'+(on?armedLabel:label)+'</button>'}
function aTeams(D){
  return '<p class="hint">Namen hier ändern, Spielplan und Tabellen übernehmen sie automatisch. Logos als PNG oder JPG, sie werden einheitlich zugeschnitten.</p><div class="rows">'+
   allGroups().map(function(g){return '<h2 class="sec">'+esc(g)+'</h2>'+D.teams.filter(function(t){return t.group===g}).map(function(t){return '<div class="card"><div class="row"><input class="in grow" id="tn-'+t.id+'" data-k="team.name" data-id="'+t.id+'" value="'+esc(t.name)+'" aria-label="Teamname"></div>'+
    '<div class="upl" style="margin-top:8px">'+logo(t,44)+'<label class="btn ghost sm">'+(t.logo?"Logo ändern":"Logo hochladen")+'<input type="file" accept="image/png,image/jpeg" data-logo="'+t.id+'"></label>'+(t.logo?'<button class="btn icon sm" data-act="delLogo" data-id="'+t.id+'">Logo entfernen</button>':'')+'</div></div>'}).join("")}).join("")+'</div>';
}
function aPlan(D){
  var fs=["Offen","Alle","Samstag","Sonntag","Damen","Herren"];
  var chips='<div class="chips" role="group" aria-label="Spiele filtern">'+fs.map(function(f){return '<button class="chip" data-afilter="'+f+'" aria-pressed="'+(f===afilter)+'">'+f+'</button>'}).join("")+'</div>';
  var ms=sortedMatches().filter(function(m){
    if(afilter==="Offen")return !hasScore(m);if(afilter==="Samstag")return mday(m)===D.settings.day;if(afilter==="Sonntag")return mday(m)!==D.settings.day;
    if(afilter==="Damen"||afilter==="Herren")return m.cat===afilter;return true});
  function teamSel(m,side){var auto=m[side==="home"?"hsrc":"asrc"],cur=m[side]||"",r=resolve(m,side);
    var o=(auto?opt("","Automatisch: "+(r?r.name:m[side==="home"?"hn":"an"]),cur):"")+D.teams.filter(function(t){return t.group.indexOf(m.cat)===0}).map(function(t){return opt(t.id,t.name,cur)}).join("");
    return '<select class="in" id="'+side+'-'+m.id+'" data-k="m.'+side+'" data-id="'+m.id+'" aria-label="'+(side==="home"?"Team 1":"Team 2")+'">'+o+'</select>'}
  return '<p class="hint">Tore eintragen und beim Spiel auf „Speichern“ tippen – das Ergebnis ist sofort online. „Leeren“ entfernt ein Ergebnis wieder. Leere Felder heißen: noch nicht gespielt. Halbfinals und Platzierungsspiele füllen sich automatisch, sobald die Gruppen fertig sind.</p>'+chips+
   (ms.length?'<div class="rows">'+ms.map(function(m){var sc=hasScore(m),ko=isKO(m);
    return '<div class="card'+(sc?" done":"")+'"><div class="mhead"><span class="code">'+esc(m.id)+'</span><b>'+esc(fmtDay(mday(m),{weekday:"short"}))+' '+esc(m.time)+'</b><span>'+esc(hall(m))+'</span><span>'+esc(m.cat)+' · '+esc(m.group?shortG(m.group):m.round)+'</span></div>'+
     '<div class="mrow">'+(m.hsrc?teamSel(m,"home"):'<span class="tn">'+esc(sideName(m,"home"))+'</span>')+'<input class="in score-in" id="hs-'+m.id+'" inputmode="numeric" data-k="m.hs" data-id="'+m.id+'" value="'+(num(m.hs)?m.hs:"")+'" aria-label="Tore Team 1">'+
     '<span class="vsl">gegen</span>'+(m.asrc?teamSel(m,"away"):'<span class="tn">'+esc(sideName(m,"away"))+'</span>')+'<input class="in score-in" id="as-'+m.id+'" inputmode="numeric" data-k="m.as" data-id="'+m.id+'" value="'+(num(m.as)?m.as:"")+'" aria-label="Tore Team 2"></div>'+
     (ko?'<div class="so-row"><span>Bei Unentschieden: 7-m-Schießen</span><input class="in score-in" id="hp-'+m.id+'" inputmode="numeric" data-k="m.hp" data-id="'+m.id+'" value="'+(num(m.hp)?m.hp:"")+'" aria-label="7 m Team 1"><input class="in score-in" id="ap-'+m.id+'" inputmode="numeric" data-k="m.ap" data-id="'+m.id+'" value="'+(num(m.ap)?m.ap:"")+'" aria-label="7 m Team 2"></div>':'')+
     '<details class="more"><summary>Zeit und Halle ändern</summary><div class="mgrid"><input class="in" type="date" id="d-'+m.id+'" data-k="m.day" data-id="'+m.id+'" value="'+esc(mday(m))+'" aria-label="Tag"><input class="in" type="time" id="t-'+m.id+'" data-k="m.time" data-id="'+m.id+'" value="'+esc(m.time)+'" aria-label="Uhrzeit"><select class="in" id="p-'+m.id+'" data-k="m.pitch" data-id="'+m.id+'" aria-label="Halle">'+opt("Ost","Halle Ost",m.pitch)+opt("West","Halle West",m.pitch)+'</select></div></details>'+saveRow(m)+'</div>'}).join("")+'</div>'
    :'<div class="empty">'+(afilter==="Offen"?"Alle Spiele haben ein Ergebnis.":"Keine Spiele in dieser Auswahl.")+'</div>');
}
function mvBtns(upAct,downAct,id,first,last,extra){return (first?'':'<button class="btn icon sm" data-act="'+upAct+'" data-id="'+id+'"'+(extra||'')+' aria-label="Nach oben">↑</button>')+(last?'':'<button class="btn icon sm" data-act="'+downAct+'" data-id="'+id+'"'+(extra||'')+' aria-label="Nach unten">↓</button>')}
function aFood(D){
  return '<p class="hint">Zwei Karten: tagsüber in der Halle und für die Playersparty. Mit den Pfeilen änderst du die Reihenfolge. Ausverkauftes bleibt sichtbar, aber durchgestrichen.</p>'+AREAS.map(function(a){
    var cats=D.menu.filter(function(c){return c.area===a[0]});
    return '<h2 class="sec">'+esc(a[1])+'</h2>'+cats.map(function(c,ci){
    return '<div class="card"><div class="row"><input class="in grow" style="font-weight:800" id="c-'+c.id+'" data-k="cat.name" data-id="'+c.id+'" value="'+esc(c.name)+'" aria-label="Kategorie">'+mvBtns("catUp","catDown",c.id,ci===0,ci===cats.length-1)+armBtn("delCat",c.id,"✕","Löschen?")+'</div><div class="rows" style="margin-top:10px">'+
    c.items.map(function(i,ii){return '<div style="border-top:1px solid var(--line);padding-top:8px"><div class="row"><input class="in grow" id="in-'+i.id+'" data-k="it.name" data-cid="'+c.id+'" data-id="'+i.id+'" value="'+esc(i.name)+'" aria-label="Name"><input class="in" style="width:86px;text-align:right" id="ip-'+i.id+'" inputmode="decimal" data-k="it.price" data-cid="'+c.id+'" data-id="'+i.id+'" value="'+String(i.price).replace(".",",")+'" aria-label="Preis in Euro"><span>€</span></div>'+
     '<div class="row" style="margin-top:6px"><input class="in grow" id="it-'+i.id+'" data-k="it.note" data-cid="'+c.id+'" data-id="'+i.id+'" value="'+esc(i.note)+'" placeholder="Hinweis (optional)" aria-label="Hinweis"><label class="row" style="font-size:.85rem;gap:4px"><input type="checkbox" id="io-'+i.id+'" data-k="it.out" data-cid="'+c.id+'" data-id="'+i.id+'"'+(i.out?" checked":"")+'>aus</label>'+mvBtns("itemUp","itemDown",i.id,ii===0,ii===c.items.length-1,' data-cid="'+c.id+'"')+'<button class="btn icon sm" data-act="delItem" data-cid="'+c.id+'" data-id="'+i.id+'" aria-label="Angebot löschen">✕</button></div></div>'}).join("")+
    '</div><button class="btn ghost sm" data-act="addItem" data-id="'+c.id+'" style="margin-top:10px">Angebot hinzufügen</button></div>'}).join("")+
   '<button class="btn ghost" data-act="addCat" data-area="'+a[0]+'" style="margin-bottom:8px">Kategorie für „'+esc(a[1])+'“ hinzufügen</button>'}).join("");
}
function aInfo(D){
  return '<p class="hint">Diese Abschnitte erscheinen auf der Startseite hinter dem „i“. Zeilenumbrüche bleiben erhalten.</p>'+D.info.map(function(x,i){
    return '<div class="card"><div class="row"><input class="in grow" style="font-weight:800" id="if-'+x.id+'" data-k="info.title" data-id="'+x.id+'" value="'+esc(x.title)+'" aria-label="Überschrift">'+
     mvBtns("infoUp","infoDown",x.id,i===0,i===D.info.length-1)+armBtn("delInfo",x.id,"✕","Löschen?")+'</div>'+
     '<textarea class="in" style="margin-top:8px" id="it-'+x.id+'" data-k="info.text" data-id="'+x.id+'" aria-label="Text">'+esc(x.text)+'</textarea></div>'}).join("")+
   '<button class="btn ghost" data-act="addInfo">Abschnitt hinzufügen</button>';
}
function aGeneral(D){
  var days={};slotGroups(D).forEach(function(g){(days[g.day]=days[g.day]||[]).push(g)});
  var plan=Object.keys(days).sort().map(function(d){return '<h2 class="sec">'+esc(fmtDay(d))+'</h2><div class="mgrid">'+days[d].map(function(g){
      var last=g.ms[g.ms.length-1],end=last?tfmt(tmin(last.time)+durOf(D,last)):"";
      return '<div><label class="f" for="st-'+esc(d+g.hall)+'" style="margin-top:0">Start '+esc(g.hall?"Halle "+g.hall:"")+'</label><input class="in" type="time" id="st-'+esc(d+g.hall)+'" data-k="start" data-day="'+esc(d)+'" data-hall="'+esc(g.hall)+'" value="'+esc(startOf(D,d,g.hall,g.ms))+'"><div class="hint" style="margin:4px 0 0">'+g.ms.length+' Spiele, Ende '+esc(end)+' Uhr</div></div>'}).join("")+'</div>'}).join("");
  return '<div class="card"><h2 class="sec" style="margin-top:0">Spielzeiten und Starts</h2><p class="hint">Änderst du hier einen Wert, rechnet die App alle Anstoßzeiten neu: Spiele einer Halle laufen am Tag in ihrer bisherigen Reihenfolge nacheinander, jeweils Spielzeit plus Wechsel. Einzeln geänderte Zeiten werden dabei überschrieben.</p>'+
   '<div class="mgrid"><div><label class="f" for="sdd" style="margin-top:0">Damen (Min.)</label><input class="in" id="sdd" type="number" min="1" data-k="tp.durD" value="'+esc(D.settings.durD||25)+'"></div>'+
   '<div><label class="f" for="sdh" style="margin-top:0">Herren (Min.)</label><input class="in" id="sdh" type="number" min="1" data-k="tp.durH" value="'+esc(D.settings.durH||20)+'"></div>'+
   '<div><label class="f" for="spa" style="margin-top:0">Wechsel (Min.)</label><input class="in" id="spa" type="number" min="0" data-k="tp.pause" value="'+esc(D.settings.pause==null?5:D.settings.pause)+'"></div></div>'+plan+'<p class="hint" style="margin-top:14px">Spielplan aus der Vorlage im Repository übernehmen (Paarungen, Runden, Hallen, Zeiten). Teamnamen, Logos und Ergebnisse unveränderter Spiele bleiben erhalten.</p>'+armBtn("loadPlan","","Spielplan aus Vorlage übernehmen","Wirklich übernehmen?","ghost sm")+'</div>'+
   '<div class="card"><h2 class="sec" style="margin-top:0">Live-Anzeige</h2><p class="hint">Mit Spielzeit und echter Uhrzeit erkennt der Spielplan, welche Spiele gerade laufen. Sobald ein Ergebnis eingetragen ist, gilt ein Spiel als beendet.</p>'+
   '<label class="f" for="sday" style="margin-top:0">Erster Turniertag</label><input class="in" id="sday" type="date" data-k="set.day" value="'+esc(D.settings.day||"")+'"></div>'+
   '<div class="card"><label class="f" for="sd" style="margin-top:0">Datum als Text</label><input class="in" id="sd" data-k="set.date" value="'+esc(D.settings.date)+'">'+
   '<label class="f" for="sp">Ort</label><input class="in" id="sp" data-k="set.place" value="'+esc(D.settings.place)+'"></div>'+
   '<div class="card"><h2 class="sec" style="margin-top:0">Vereinslogo</h2><div class="upl"><span class="lg" style="--s:56px"><img src="'+curLogo()+'" alt=""></span><label class="btn ghost sm">Logo ersetzen<input type="file" accept="image/png,image/jpeg" data-clublogo="1"></label></div></div>'+
   '<p class="hint">Veröffentlichen speichert alles in Firebase. Alle geöffneten Ansichten aktualisieren sich danach von selbst.</p>';
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
  var D=DRAFT,body=({teams:aTeams,plan:aPlan,info:aInfo,general:aGeneral}[atab]||aPlan)(D),d=isDirty();
  return '<div class="ph"><div class="wrap"><img src="'+curLogo()+'" alt="Zur Startseite" role="button" tabindex="0" data-go="home"><h1>Orga</h1><button class="info-btn out" data-atab="info" aria-label="Infos bearbeiten">i</button><button class="btn ghost sm" data-act="logout">Abmelden</button></div>'+
   '<div class="wrap"><div class="atabs">'+ATABS.map(function(a){return '<button class="chip" data-atab="'+a[0]+'" aria-pressed="'+(a[0]===atab)+'">'+a[1]+'</button>'}).join("")+'</div></div></div>'+
   '<main style="padding-bottom:120px"><div class="wrap">'+body+'</div></main>'+
   '<div class="savebar"><div class="wrap"><span class="st'+(d?" dirty":"")+'" id="st">'+(publishing?"Wird veröffentlicht …":d?"Ungespeicherte Änderungen":"Alles veröffentlicht")+'</span>'+armBtn("reset","","Verwerfen","Wirklich verwerfen?","ghost sm")+'<button class="btn blue sm" data-act="publish"'+(d&&!publishing?"":" disabled")+'>Veröffentlichen</button></div></div>';
}

/* ---------- Darstellung ---------- */
function render(keep){
  if(!STATE){app.innerHTML='<main><div class="wrap"><p class="empty" style="margin-top:30vh">Turnierdaten werden geladen …</p></div></main>';return}
  var y=window.scrollY;clearCache();
  if(route==="admin"){if(!authed()){app.innerHTML=vLogin();bindLogin();return}if(!DRAFT)loadDraft();app.innerHTML=vAdmin()}
  else{DRAFT=null;app.innerHTML=({home:vHome,plan:vPlan,teams:vTeams,table:vTable,info:vInfo}[route]||vHome)()}
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
  var el=e.target,k=el.dataset.k;if(!k||!DRAFT)return;var id=el.dataset.id,v=el.type==="checkbox"?el.checked:el.value;
  if(k==="team.name")DRAFT.teams.find(function(t){return t.id===id}).name=v;
  else if(k.indexOf("m.")===0){var m=findM(id),f=k.slice(2);
    if(f==="hs"||f==="as"||f==="hp"||f==="ap"){var n=parseNum(v);m[f]=n===null?null:Math.max(0,Math.round(n))}else m[f]=v;
    if(f==="home"||f==="away"||f==="pitch"){markDirty();render(true);return}
    updRes(id)}
  else if(k.indexOf("it.")===0){var c=findC(el.dataset.cid),it=c.items.find(function(i){return i.id===id}),g=k.slice(3);
    if(g==="price"){var p=parseNum(v);it.price=p===null?0:p}else it[g]=v}
  else if(k==="cat.name")findC(id).name=v;
  else if(k==="info.title"||k==="info.text")DRAFT.info.find(function(x){return x.id===id})[k.slice(5)]=v;
  else if(k.indexOf("set.")===0)DRAFT.settings[k.slice(4)]=v;
  else if(k.indexOf("tp.")===0||k==="start")return;
  markDirty();
});
/* Zeitplan-Einstellungen: erst nach fertiger Eingabe neu rechnen */
app.addEventListener("change",function(e){
  var el=e.target,k=el.dataset.k;if(!DRAFT||!(k==="start"||(k&&k.indexOf("tp.")===0)))return;var v=el.value;
  var old=clone(DRAFT.settings);
  if(k==="start"){if(tmin(v)===null)return;var ss=DRAFT.settings.starts=DRAFT.settings.starts||{};(ss[el.dataset.day]=ss[el.dataset.day]||{})[el.dataset.hall]=v;
    slotGroups(DRAFT).forEach(function(g){if(!(ss[g.day]&&tmin(ss[g.day][g.hall])!==null)){(ss[g.day]=ss[g.day]||{})[g.hall]=startOf(DRAFT,g.day,g.hall,g.ms)}})}
  else{var n=parseNum(v);if(n===null||n<(k==="tp.pause"?0:1))return;DRAFT.settings[k.slice(3)]=Math.round(n)}
  reflow(DRAFT,old);clearCache();markDirty();render(true);toast("Alle Spielzeiten angepasst. Zum Übernehmen veröffentlichen.")});

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
var RES=["hs","as","hp","ap","home","away"];
function resKey(m){return m?RES.map(function(f){return m[f]==null?"":m[f]}).join("|"):""}
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
  if(clear){["hs","as","hp","ap"].forEach(function(f){m[f]=null})}
  else if(num(m.hs)!==num(m.as)){toast("Bitte beide Tore eintragen (0 ist erlaubt).");return}
  var vals={};RES.forEach(function(f){vals[f]=m[f]==null?null:m[f]});
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
  var t=e.target.closest("[data-go],[data-filter],[data-atab],[data-afilter],[data-tcat],[data-act],[data-team]");if(!t)return;
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
  if(a==="loadPlan"){if(!arm("loadPlan:"))return;loadPlan();return}
  if(a==="reset"){if(!arm("reset:"))return;DRAFT=clone(STATE);saveDraft();render(true);toast("Änderungen verworfen");return}
  if(a==="delLogo"){DRAFT.teams.find(function(x){return x.id===id}).logo=""}
  else if(a==="addInfo"){DRAFT.info.push({id:uid("n"),title:"Neuer Abschnitt",text:""})}
  else if(a==="delInfo"){if(!arm("delInfo:"+id))return;DRAFT.info=DRAFT.info.filter(function(x){return x.id!==id})}
  else if(a==="infoUp"||a==="infoDown"){swapIn(DRAFT.info,DRAFT.info.findIndex(function(x){return x.id===id}),a==="infoUp"?-1:1)}
  else if(a==="catUp"||a==="catDown"){var cc=findC(id),same=DRAFT.menu.map(function(c,k){return c.area===cc.area?k:-1}).filter(function(k){return k>=0}),p=same.indexOf(DRAFT.menu.indexOf(cc)),q=p+(a==="catUp"?-1:1);
    if(q>=0&&q<same.length){var t1=DRAFT.menu[same[p]];DRAFT.menu[same[p]]=DRAFT.menu[same[q]];DRAFT.menu[same[q]]=t1}}
  else if(a==="itemUp"||a==="itemDown"){var ic=findC(t.dataset.cid);swapIn(ic.items,ic.items.findIndex(function(x){return x.id===id}),a==="itemUp"?-1:1)}
  else if(a==="addCat"){DRAFT.menu.push({id:uid("c"),name:"Neue Kategorie",area:t.dataset.area==="party"?"party":"tag",items:[]})}
  else if(a==="delCat"){if(!arm("delCat:"+id))return;DRAFT.menu=DRAFT.menu.filter(function(c){return c.id!==id})}
  else if(a==="addItem"){findC(id).items.push({id:uid("i"),name:"Neues Angebot",price:0,note:"",out:false})}
  else if(a==="delItem"){var c=findC(t.dataset.cid);c.items=c.items.filter(function(i){return i.id!==id})}
  else return;
  markDirty();render(true);
});
app.addEventListener("keydown",function(e){if((e.key==="Enter"||e.key===" ")&&e.target.matches("img[data-go]")){e.preventDefault();go(e.target.dataset.go)}});

/* ---------- Start ---------- */
setInterval(function(){if((route==="plan"||route==="home"))render(true)},20000);
window.addEventListener("pagehide",saveResume);
var res=lsGet("nt-resume");
if(res&&Date.now()-res.t<90e3){route=res.route||"home";atab=res.atab||atab;afilter=res.afilter||afilter;filter=res.filter||"Alle";tcat=res.tcat||tcat}
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
window.__nt={S:S,standings:standings,prTable:prTable,finalPlaces:finalPlaces,resolve:resolve,clearCache:clearCache,setState:function(s){STATE=norm(s);clearCache()}};
