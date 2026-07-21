let clerkReady = null;

async function initClerk() {
  if (window.Clerk) {
    if (!window.Clerk.loaded) await window.Clerk.load();
    return window.Clerk;
  }

  if (!clerkReady) {
    clerkReady = (async () => {
      const res = await fetch("/api/clerk-config");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load Clerk config");

      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.async = true;
        script.crossOrigin = "anonymous";
        script.src =
          "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
        script.dataset.clerkPublishableKey = data.publishableKey;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load Clerk"));
        document.head.appendChild(script);
      });

      await window.Clerk.load();
      return window.Clerk;
    })();
  }

  return clerkReady;
}

async function getClerkToken() {
  const clerk = await initClerk();
  if (!clerk.session) return null;
  return clerk.session.getToken();
}

function redirectParam() {
  return new URLSearchParams(window.location.search).get("redirect_url") || "/app.html";
}

async function mountAuthNav(container, { signedInExtra } = {}) {
  const clerk = await initClerk();
  container.innerHTML = "";

  if (clerk.user) {
    const wrap = document.createElement("div");
    wrap.className = "auth-nav-signed-in";
    if (signedInExtra) wrap.appendChild(signedInExtra);
    const userBtn = document.createElement("div");
    userBtn.className = "clerk-user-button";
    wrap.appendChild(userBtn);
    container.appendChild(wrap);
    clerk.mountUserButton(userBtn, { afterSignOutUrl: "/" });
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "auth-nav-signed-out";

  const signIn = document.createElement("a");
  signIn.className = "btn ghost auth-btn";
  signIn.href = `/sign-in.html?redirect_url=${encodeURIComponent(
    window.location.pathname === "/" ? "/app.html" : window.location.pathname
  )}`;
  signIn.textContent = "Sign in";

  const signUp = document.createElement("a");
  signUp.className = "btn primary auth-btn";
  signUp.href = `/sign-up.html?redirect_url=${encodeURIComponent("/app.html")}`;
  signUp.textContent = "Sign up";

  wrap.append(signIn, signUp);
  container.appendChild(wrap);
}

async function requireSignedIn() {
  const clerk = await initClerk();
  if (!clerk.user) {
    window.location.href = `/sign-in.html?redirect_url=${encodeURIComponent(redirectParam())}`;
    return false;
  }
  return true;
}

window.initClerk = initClerk;
window.getClerkToken = getClerkToken;
window.mountAuthNav = mountAuthNav;
window.requireSignedIn = requireSignedIn;
window.clerkRedirectParam = redirectParam;
