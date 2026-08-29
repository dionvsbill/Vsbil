"use strict";
(async()=>{
  const money=v=>`₵${(Number(v||0)/100).toFixed(2)}`;
  const esc=v=>String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  try{
    const d=await VSBIL_AUTH.api("/api/dashboard");
    const w=d.wallet||{};
    const available=document.getElementById("availableBalance"),pending=document.getElementById("pendingBalance"),total=document.getElementById("totalEarned"),today=document.getElementById("todayEarnings"),refEarn=document.getElementById("referralEarnings");
    if(available)available.textContent=(Number(w.available||0)/100).toFixed(2);
    if(pending)pending.textContent=money(w.pending);
    if(total)total.textContent=money(w.totalEarned);
    if(today)today.textContent=money(d.activity?.todayEarnings);
    if(refEarn)refEarn.textContent=money(d.referrals?.earnings);
    const box=document.getElementById("dashboardCampaigns");
    if(box){const c=await VSBIL_AUTH.api("/api/activities");box.innerHTML=(c.activities||[]).slice(0,6).map(a=>`<article class="dashboard-campaign-card"><h3>${esc(a.title)}</h3><p>${esc(a.action)} · ${money(a.reward_amount)} · ${Number(a.minimum_seconds||30)}s minimum</p><a class="secondary-btn" href="/activities.html">Complete activity →</a></article>`).join("")||'<p class="muted">No active campaigns are available right now.</p>';}
    const withdraw=document.getElementById("withdrawBtn");
    if(withdraw){const clone=withdraw.cloneNode(true);withdraw.replaceWith(clone);clone.addEventListener("click",()=>location.href="/wallet.html#withdraw");}
    const notices=document.querySelector(".notification-empty");
    const items=d.notifications||[];
    if(notices&&items.length){notices.innerHTML=items.slice(0,8).map(n=>`<div class="notification-item"><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small>${new Date(n.created_at).toLocaleString()}</small></div>`).join("");}
  }catch(error){console.warn("Dashboard enhancement failed",error);}
})();
