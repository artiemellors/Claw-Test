function createDashboardHtml() {
 return <!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clawhub Rate Limit Dashboard</title>
<style>
  * { margin:0; box-sizing:border-box; }
  body { font-family:system-ui,sans-serif; background:#0d1117; color:#c9d1d9; display:flex; justify-content:center; align-items:center; min-height:100vh; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:12px; padding:2rem; width:400px; }
  h1 { font-size:1.2rem; margin-bottom:1.5rem; color:#58a6ff; }
  .meter { background:#21262d; border-radius:8px; height:28px; overflow:hidden; margin:1rem 0; }
  .meter-fill { height:100%; border-radius:8px; transition:width .4s ease, background .4s ease; }
  .stats { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; }
  .stat { background:#21262d; padding:.75rem; border-radius:8px; }
  .stat-label { font-size:.75rem; color:#8b949e; }
  .stat-value { font-size:1.4rem; font-weight:600; margin-top:.25rem; }
  .err { color:#f85149; margin-top:1rem; }
  #refresh { margin-top:1rem; background:#238636; color:#fff; border:none; padding:.5rem 1rem; border-radius:6px; cursor:pointer; font-size:.9rem; }
  #refresh:hover { background:#2ea043; }
</style>
</head>
<body>
<div class="card">
  <h1>⚡ Clawhub Rate Limit</h1>
  <div class="meter"><div class="meter-fill" id="bar"></div></div>
  <div class="stats">
    <div class="stat"><div class="stat-label">剩餘</div><div class="stat-value" id="remaining">-</div></div>
    <div class="stat"><div class="stat-label">上限</div><div class="stat-value" id="limit">-</div></div>
    <div class="stat"><div class="stat-label">已用</div><div class="stat-value" id="used">-</div></div>
    <div class="stat"><div class="stat-label">重置 (秒)</div><div class="stat-value" id="reset">-</div></div>
  </div>
  <div class="err" id="err" role="alert"></div>
  <button id="refresh">重新整理</button>
</div>
<script>
async function load(){
  try{
    const r=await fetch("/rate-limit/status");
    const d=await r.json();
    document.getElementById("remaining").textContent=d.remaining;
    document.getElementById("limit").textContent=d.limit;
    document.getElementById("used").textContent=d.used;
    document.getElementById("reset").textContent=d.window;
    const pct=(d.remaining/d.limit)*100;
    const bar=document.getElementById("bar");
    bar.style.width=pct+"%";
    bar.style.background=pct>50?"#238636":pct>20?"#d29922":"#f85149";
    document.getElementById("err").textContent=d.remaining<=0?"⚠ 已達到速率限制！":"";
  }catch(e){document.getElementById("err").textContent="無法取得狀態";}
}
document.getElementById("refresh").addEventListener("click",load);
load();setInterval(load,5000);
</script>
</body>
</html>;
}

module.exports = { createDashboardHtml };