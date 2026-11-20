const $ = (id) => document.getElementById(id);
const input = $("expression");
const result = $("result");
const canvas = $("graph");
const ctx = canvas.getContext("2d");
let memory = Number(localStorage.getItem("cgcalc-memory") || 0);
let history = [];
try { history = JSON.parse(localStorage.getItem("cgcalc-history") || "[]"); } catch { history = []; }
let currentExpr = "";
let view = { xMin: -10, xMax: 10, yMin: -5.5, yMax: 5.5 };
let drag = null;

function tokenize(s) {
  s = s.replace(/π/g, "pi").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  const tokens = s.match(/(?:\d+(?:\.\d*)?|\.\d+)|(?:[a-zA-Z_][a-zA-Z_0-9]*)|(?:\*\*|[+\-*/^(),])/g);
  if (!tokens || tokens.join("") !== s.replace(/\s+/g, "")) throw Error("Check the expression.");
  return tokens;
}
const functions = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, sqrt: Math.sqrt, log: Math.log10, ln: Math.log, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, exp: Math.exp
};
function compile(source) {
  let t = tokenize(source), i = 0;
  const peek = () => t[i], take = () => t[i++];
  function primary() {
    const v = take();
    if (v === undefined) throw Error("Incomplete expression.");
    if (v === "+") return primary();
    if (v === "-") return () => -primary()();
    if (v === "(") { const n = expression(); if (take() !== ")") throw Error("Missing closing parenthesis."); return n; }
    if (/^(?:\d|\.)/.test(v)) { const n = Number(v); return () => n; }
    if (/^[a-z]/i.test(v)) {
      if (v === "x") return x => x;
      if (v === "pi") return () => Math.PI;
      if (v === "e") return () => Math.E;
      if (functions[v]) {
        if (take() !== "(") throw Error(v + " needs parentheses.");
        const arg = expression(); if (take() !== ")") throw Error("Missing closing parenthesis.");
        return x => functions[v](arg(x));
      }
      throw Error("Unknown name: " + v);
    }
    throw Error("Unexpected token: " + v);
  }
  function power() { let a = primary(); if (peek() === "^" || peek() === "**") { take(); const b = power(); const old = a; a = x => Math.pow(old(x), b(x)); } return a; }
  function term() {
    let a = power();
    while (peek() === "*" || peek() === "/") { const op = take(), b = power(), old = a; a = op === "*" ? x => old(x)*b(x) : x => old(x)/b(x); }
    return a;
  }
  function expression() {
    let a = term();
    while (peek() === "+" || peek() === "-") { const op = take(), b = term(), old = a; a = op === "+" ? x => old(x)+b(x) : x => old(x)-b(x); }
    return a;
  }
  const fn = expression();
  if (i !== t.length) throw Error("Unexpected token: " + peek());
  return fn;
}
function fraction(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) > 1e7) return n.toPrecision(8);
  const sign = n < 0 ? "-" : "", x = Math.abs(n);
  for (let d = 1; d <= 1000; d++) {
    const a = Math.round(x*d);
    if (Math.abs(x-a/d) < 1e-9) return sign + (d === 1 ? String(a) : `${a}/${d}`);
  }
  return Number(n.toPrecision(10)).toString();
}
function calculate() {
  const expr = input.value.trim();
  if (!expr) return null;
  const value = compile(expr)(0);
  if (!Number.isFinite(value)) throw Error("Result is not finite.");
  return value;
}
function addHistory(expr, value) {
  history.unshift({expr, value});
  history = history.slice(0, 12);
  localStorage.setItem("cgcalc-history", JSON.stringify(history));
  $("history").innerHTML = "";
  if (!history.length) $("history").innerHTML = '<li class="empty">Your calculations will appear here.</li>';
  history.forEach(item => {
    const li = document.createElement("li");
    li.textContent = `${item.expr} = ${fraction(item.value)}`;
    li.title = "Click to restore expression";
    li.addEventListener("click", () => { input.value = item.expr; input.focus(); });
    $("history").appendChild(li);
  });
}
function evaluate() {
  try {
    const value = calculate();
    if (value === null) return;
    result.textContent = `= ${fraction(value)}  (${Number(value.toPrecision(10))})`;
    addHistory(input.value.trim(), value);
    return value;
  } catch (e) { result.textContent = e.message; return null; }
}
function drawGraph(expr = currentExpr) {
  currentExpr = expr;
  $("graphLabel").textContent = "y = " + (expr || "—");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--bg").trim(); ctx.fillRect(0,0,w,h);
  const X = x => (x-view.xMin)/(view.xMax-view.xMin)*w;
  const Y = y => h-(y-view.yMin)/(view.yMax-view.yMin)*h;
  ctx.lineWidth = 1; ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--line").trim();
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted").trim();
  ctx.font = "11px system-ui";
  const xStep = niceStep((view.xMax-view.xMin)/8), yStep = niceStep((view.yMax-view.yMin)/6);
  for(let x=Math.ceil(view.xMin/xStep)*xStep; x<=view.xMax; x+=xStep) {
    ctx.beginPath(); ctx.moveTo(X(x),0); ctx.lineTo(X(x),h); ctx.stroke();
    if (Math.abs(x) > 1e-8) ctx.fillText(Number(x.toPrecision(4)), X(x)+3, Math.max(12,Math.min(h-3,Y(0)+13)));
  }
  for(let y=Math.ceil(view.yMin/yStep)*yStep; y<=view.yMax; y+=yStep) {
    ctx.beginPath(); ctx.moveTo(0,Y(y)); ctx.lineTo(w,Y(y)); ctx.stroke();
    if (Math.abs(y) > 1e-8) ctx.fillText(Number(y.toPrecision(4)), Math.max(2,Math.min(w-25,X(0)+4)), Y(y)-3);
  }
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--muted").trim(); ctx.lineWidth=1.5;
  if(view.xMin<=0 && view.xMax>=0){ctx.beginPath();ctx.moveTo(X(0),0);ctx.lineTo(X(0),h);ctx.stroke();}
  if(view.yMin<=0 && view.yMax>=0){ctx.beginPath();ctx.moveTo(0,Y(0));ctx.lineTo(w,Y(0));ctx.stroke();}
  if (!expr) return;
  let fn; try { fn = compile(expr); } catch(e) { result.textContent=e.message; return; }
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--accent").trim();
  ctx.lineWidth=2.6; ctx.beginPath(); let started=false, prevY=null;
  for(let px=0; px<=w; px++) {
    const x=view.xMin+(px/w)*(view.xMax-view.xMin);
    const y=fn(x), py=Y(y);
    if(Number.isFinite(y) && Math.abs(py)<h*4 && (prevY===null || Math.abs(py-prevY)<h*1.5)) {
      if(!started){ctx.moveTo(px,py);started=true;} else ctx.lineTo(px,py);
    } else { if(started)ctx.stroke(); ctx.beginPath();started=false; }
    prevY=Number.isFinite(py)?py:null;
  }
  if(started)ctx.stroke();
}
function niceStep(raw) { const p=Math.pow(10,Math.floor(Math.log10(raw))); const q=raw/p; return (q<1.5?1:q<3.5?2:q<7.5?5:10)*p; }
function graph() { if(!input.value.trim()) return; drawGraph(input.value.trim()); }
function insert(text) {
  const start=input.selectionStart, end=input.selectionEnd;
  input.setRangeText(text,start,end,"end"); input.focus();
}
document.querySelectorAll("[data-insert]").forEach(b=>b.addEventListener("click",()=>insert(b.dataset.insert)));
$("equals").addEventListener("click",evaluate);
$("graphBtn").addEventListener("click",graph);
$("clear").addEventListener("click",()=>{input.value="";result.textContent="Cleared.";input.focus();});
$("backspace").addEventListener("click",()=>{const s=input.selectionStart,e=input.selectionEnd;if(s===e&&s>0)input.setSelectionRange(s-1,e);input.setRangeText("",input.selectionStart,input.selectionEnd,"end");input.focus();});
input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();e.shiftKey?graph():evaluate();} if(e.key==="Escape"){input.value="";}});
$("resetView").addEventListener("click",()=>{view={xMin:-10,xMax:10,yMin:-5.5,yMax:5.5};drawGraph();});
$("zoomIn").addEventListener("click",()=>zoom(.75));
$("zoomOut").addEventListener("click",()=>zoom(1.33));
function zoom(f){const cx=(view.xMin+view.xMax)/2,cy=(view.yMin+view.yMax)/2,hw=(view.xMax-view.xMin)*f/2,hh=(view.yMax-view.yMin)*f/2;view={xMin:cx-hw,xMax:cx+hw,yMin:cy-hh,yMax:cy+hh};drawGraph();}
canvas.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,view:{...view}};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener("pointermove",e=>{if(!drag)return;const r=canvas.getBoundingClientRect(),dx=(e.clientX-drag.x)/r.width*(drag.view.xMax-drag.view.xMin),dy=(e.clientY-drag.y)/r.height*(drag.view.yMax-drag.view.yMin);view={xMin:drag.view.xMin-dx,xMax:drag.view.xMax-dx,yMin:drag.view.yMin+dy,yMax:drag.view.yMax+dy};drawGraph();});
canvas.addEventListener("pointerup",()=>drag=null);
canvas.addEventListener("wheel",e=>{e.preventDefault();zoom(e.deltaY<0?.88:1.14);},{passive:false});
function updateMemory(){ $("memoryValue").textContent="M: "+fraction(memory); localStorage.setItem("cgcalc-memory", String(memory)); }
$("mc").onclick=()=>{memory=0;updateMemory();};
$("mr").onclick=()=>insert(String(memory));
$("ms").onclick=()=>{const v=calculate();if(v!==null){memory=v;updateMemory();}};
$("mplus").onclick=()=>{const v=calculate();if(v!==null){memory+=v;updateMemory();}};
$("mminus").onclick=()=>{const v=calculate();if(v!==null){memory-=v;updateMemory();}};
$("clearHistory").onclick=()=>{history=[];localStorage.setItem("cgcalc-history", "[]");$("history").innerHTML='<li class="empty">Your calculations will appear here.</li>';};
$("themeBtn").onclick=()=>{document.body.classList.toggle("light");drawGraph();};
drawGraph();
updateMemory();
history.slice().reverse().forEach(item => { /* restored below in chronological order */ });
if (history.length) { const saved = history.slice().reverse(); history = []; saved.forEach(item => addHistory(item.expr, item.value)); }
