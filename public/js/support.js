(() => {
  document.querySelectorAll('[data-support-form]').forEach(form => {
    const message = form.querySelector('[data-message]');
    const submit = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      message.className='form-message'; message.textContent=''; submit.disabled=true; submit.textContent='Submitting…';
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const response = await fetch('/api/support/tickets',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},credentials:'same-origin',body:JSON.stringify(data)});
        const result = await response.json().catch(()=>({}));
        if(!response.ok || !result.success) throw new Error(result.message || 'Unable to submit your request.');
        message.className='form-message success'; message.textContent=`Request received. Your support reference is ${result.ticket.reference}. Keep it for follow-up.`;
        form.reset();
      } catch (error) {
        message.className='form-message error'; message.textContent=error?.message || 'Unable to submit your request. Please try again.';
      } finally { submit.disabled=false; submit.textContent=form.closest('.support-page')?.querySelector('.support-hero h1')?.textContent.includes('Report')?'Submit report securely':'Send secure message'; }
    });
  });
})();