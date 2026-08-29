(() => {
  const articles = [
    ['Getting started','Account','What is VSBIL?','VSBIL connects creators and communities through eligible digital participation campaigns. Users discover campaigns, complete genuine eligible actions and receive rewards only after the activity passes verification.'],
    ['Getting started','Account','How do I create an account?','Choose Create Account, enter a valid email and a strong password, then complete email verification. Your account remains subject to the activation requirements shown in the live payment flow.'],
    ['Getting started','Account','Why must I verify my email?','Email verification protects account ownership, reduces abuse and gives VSBIL a reliable channel for security and account notifications.'],
    ['Activation','Payments','How does activation work?','After registration, VSBIL shows the activation requirement and sends you through the secure payment flow. Never send a password, OTP or card PIN to support.'],
    ['Activation','Payments','What is the launch activation price?','The current launch experience may display a discounted activation amount. Always rely on the amount shown by VSBIL immediately before payment rather than old screenshots or messages.'],
    ['Activation','Payments','My activation payment succeeded but my account is not active.','Keep the payment reference and contact support. Do not pay again until VSBIL or the payment provider confirms the first transaction status.'],
    ['Campaigns','Campaigns','Can I create a campaign?','Authenticated eligible users can publish supported campaigns through Creator Hub. Campaigns are subject to eligibility, platform rules and verification controls.'],
    ['Campaigns','Campaigns','What makes a campaign eligible?','Campaigns must use supported participation actions, provide clear requirements and rewards, and comply with VSBIL policies. Artificial engagement, misleading instructions and prohibited activity are not eligible.'],
    ['Campaigns','Campaigns','Can I participate in my own campaign?','Do not use your own accounts or coordinated artificial activity to inflate campaign results. Eligibility is determined by the campaign rules and VSBIL verification controls.'],
    ['Campaigns','Campaigns','Why did a campaign disappear?','A campaign can be paused, completed, archived, restricted or removed after a policy or verification review. Check your activity history for the latest status where available.'],
    ['YouTube','Campaigns','Does VSBIL support YouTube campaigns?','Supported YouTube actions can be offered when the campaign and platform rules allow them. Follow the exact campaign instructions and use genuine activity only.'],
    ['YouTube','Campaigns','Can I use bots or automation?','No. Bots, scripts, fake accounts, purchased engagement and other artificial activity can make activity ineligible and may lead to account restrictions.'],
    ['Rewards','Wallet','How are rewards handled?','Eligible activity is verified before rewards become available. Wallet movements are recorded in the ledger so completed and pending amounts can be distinguished.'],
    ['Rewards','Wallet','Why is my reward pending?','Pending rewards are waiting for the applicable verification or review step. Avoid repeating an action simply because a reward has not appeared immediately.'],
    ['Rewards','Wallet','Where can I see my wallet history?','Your dashboard and wallet views show available and pending balances plus ledger activity when those features are enabled for your account.'],
    ['Rewards','Wallet','Can a reward be reversed?','If an activity later fails verification or is found to violate campaign or platform rules, the corresponding reward can be withheld or reversed according to the applicable rules.'],
    ['Withdrawals','Wallet','How do withdrawals work?','When your account is eligible and your available balance meets the applicable limits, submit a withdrawal using the supported method. VSBIL records the request and its processing state.'],
    ['Withdrawals','Wallet','Why is my withdrawal pending?','Withdrawals can require review, fraud checks, payment-provider processing or additional account verification. Keep the withdrawal reference when contacting support.'],
    ['Withdrawals','Wallet','What should I send support about a withdrawal?','Provide the withdrawal reference, approximate date, amount and a clear description. Never send passwords, OTPs, card PINs or private keys.'],
    ['Referrals','Rewards','How do referrals work?','Eligible referral rewards are credited according to the active referral rules and qualification conditions. The referral ledger records qualifying movements rather than treating every signup as an immediate payout.'],
    ['Referrals','Rewards','Why did my referral reward not appear?','A referral may need to complete required verification or activation conditions before it qualifies. Check your referral status and contact support with the referral reference if something looks wrong.'],
    ['Security','Safety','How do I secure my account?','Use a unique strong password, verify your email, never share authentication codes, and sign out of unfamiliar sessions. VSBIL support will not ask for your password or OTP.'],
    ['Security','Safety','What if I think my account was compromised?','Stop sharing credentials, change your password from a trusted device and contact support immediately. Include useful account details without sending secrets.'],
    ['Safety','Safety','How do I report a suspicious campaign?','Use Report / Support and select Safety or Campaign Report. Include the campaign reference, what you observed and any non-sensitive evidence or links.'],
    ['Safety','Safety','Can I report harassment or impersonation?','Yes. Use the support/report form and choose the closest safety category. Give specific details so the moderation team can investigate.'],
    ['Privacy','Privacy','What personal data does VSBIL use?','VSBIL uses account and operational information needed to provide authentication, campaigns, rewards, security and support. Review the Privacy page for the authoritative details.'],
    ['Privacy','Privacy','Can I request deletion or access to my data?','Yes. Use the privacy support route and be prepared to verify account ownership before sensitive account information is disclosed or changed.'],
    ['Support','Support','How do I contact VSBIL?','Use Contact VSBIL for general questions and Support / Report for account, payment, campaign, safety or privacy cases. Each submission receives a support reference for follow-up.'],
    ['Support','Support','What should I never include in a ticket?','Never include passwords, one-time codes, card PINs, full card numbers, private keys or other authentication secrets. Share transaction references instead.'],
    ['Support','Support','How do I follow up on a ticket?','Keep your VSBIL support reference. If you need to add information, submit a follow-up referencing the original ticket rather than opening many duplicate requests.'],
    ['Policies','Policy','Where can I read VSBIL rules?','The footer links to the Trust Center, Terms, Privacy, Community Guidelines, Acceptable Use, Withdrawal Policy, Referral Policy, Advertising Policy and YouTube Guidelines.']
  ];
  const input = document.getElementById('faqSearch'), results = document.getElementById('faqResults'), empty = document.getElementById('faqEmpty'), title = document.getElementById('resultsTitle'), count = document.getElementById('resultCount'), cats = document.getElementById('faqCategories'), clear = document.getElementById('clearFaq');
  let category = 'All';
  const categories = ['All', ...new Set(articles.map(a => a[1]))];
  cats.innerHTML = categories.map(c => `<button type="button" class="help-chip${c === 'All' ? ' is-active' : ''}" data-category="${c}">${c}</button>`).join('');
  const escape = s => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function render() {
    const q = input.value.trim().toLowerCase();
    clear.hidden = !q;
    if (!q) { results.innerHTML=''; empty.hidden=true; count.textContent=''; title.textContent='Search to reveal help'; return; }
    const rows = articles.filter(a => (category === 'All' || a[1] === category) && a.join(' ').toLowerCase().includes(q));
    title.textContent = rows.length ? 'Relevant answers' : 'No matching help';
    count.textContent = `${rows.length} ${rows.length === 1 ? 'article' : 'articles'}`;
    results.innerHTML = rows.map((a,i) => `<details class="faq-item" ${i === 0 ? 'open' : ''}><summary><span><small>${escape(a[1])}</small>${escape(a[2])}</span><b>+</b></summary><div><p>${escape(a[3])}</p><a href="/support.html">Need more help? Contact support →</a></div></details>`).join('');
    empty.hidden = rows.length > 0;
  }
  input.addEventListener('input', render);
  clear.addEventListener('click', () => { input.value=''; input.focus(); render(); });
  cats.addEventListener('click', e => { const b=e.target.closest('[data-category]'); if(!b)return; category=b.dataset.category; cats.querySelectorAll('.help-chip').forEach(x=>x.classList.toggle('is-active',x===b)); render(); });
})();