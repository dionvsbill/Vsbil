/* VSBIL AUTH FLOW — shared production client */
"use strict";
const VSBIL_AUTH={
 async request(path,body={}){const r=await fetch(path,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.success){const e=new Error(d.message||"Something went wrong. Please try again.");e.code=d.code;e.data=d;throw e;}return d;},
 saveSession(s,u){if(!s?.accessToken)return;localStorage.setItem("vsbil_access_token",s.accessToken);if(s.refreshToken)localStorage.setItem("vsbil_refresh_token",s.refreshToken);if(s.expiresAt)localStorage.setItem("vsbil_expires_at",String(s.expiresAt));if(s.expiresIn)localStorage.setItem("vsbil_expires_in",String(s.expiresIn));localStorage.setItem("vsbil_token_type",s.tokenType||"bearer");if(u)localStorage.setItem("vsbil_user",JSON.stringify(u));},
 message(el,text,type=""){if(!el)return;el.textContent=text;el.className="form-message"+(type?` ${type}`:"");},
 toggle(input,button){button?.addEventListener("click",()=>{const show=input.type==="password";input.type=show?"text":"password";button.textContent=show?"Hide":"Show";});}
};window.VSBIL_AUTH=VSBIL_AUTH;
