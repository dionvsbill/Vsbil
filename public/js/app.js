const getStartedBtn = document.getElementById("getStartedBtn");
const createAccountBtn = document.getElementById("createAccountBtn");
const creatorBtn = document.getElementById("creatorBtn");
const loginBtn = document.getElementById("loginBtn");

const footerSignupBtn = document.getElementById("footerSignupBtn");
const footerLoginBtn = document.getElementById("footerLoginBtn");

function goToSignup() {
  window.location.href = "/register.html";
}

function goToLogin() {
  window.location.href = "/login.html";
}

getStartedBtn?.addEventListener("click", goToSignup);

createAccountBtn?.addEventListener("click", goToSignup);

footerSignupBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  goToSignup();
});

loginBtn?.addEventListener("click", goToLogin);

footerLoginBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  goToLogin();
});

creatorBtn?.addEventListener("click", () => {
  window.location.href = "/register.html?role=creator";
});