/* =================================================================
   BioSense — marketing site JS (vanilla, ~50 lines of logic)
   Handles: mobile nav, FAQ accordion, scroll reveal, nav shadow,
            footer year. Respects prefers-reduced-motion.
   ================================================================= */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Footer year ---- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---- Nav: scroll shadow + mobile toggle ---- */
  var nav = document.getElementById("site-nav");
  if (nav) {
    var onScroll = function () {
      if (window.scrollY > 6) nav.classList.add("is-scrolled");
      else nav.classList.remove("is-scrolled");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    var toggle = document.getElementById("nav-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var open = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });

      /* Close mobile menu when a link is clicked */
      var mobileLinks = nav.querySelectorAll(".nav__mobile a");
      for (var i = 0; i < mobileLinks.length; i++) {
        mobileLinks[i].addEventListener("click", function () {
          nav.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
        });
      }
    }
  }

  /* ---- FAQ accordion (single-open) ---- */
  var faqButtons = document.querySelectorAll(".faq__q");
  faqButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var item = btn.closest(".faq__item");
      if (!item) return;
      var wasOpen = item.classList.contains("is-open");

      /* Close all siblings within the same accordion */
      var accordion = item.parentElement;
      if (accordion) {
        accordion.querySelectorAll(".faq__item.is-open").forEach(function (sib) {
          sib.classList.remove("is-open");
          var b = sib.querySelector(".faq__q");
          if (b) b.setAttribute("aria-expanded", "false");
        });
      }

      if (!wasOpen) {
        item.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });

  /* ---- Scroll reveal via IntersectionObserver ---- */
  var reveals = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---- Hero video crossfade loop ----
     Rotates through N <video> elements every HOLD_MS, with a CSS
     opacity crossfade. Pauses when the tab is hidden, and is skipped
     entirely for users who prefer reduced motion. */
  var loops = document.querySelectorAll("[data-video-loop]");
  loops.forEach(function (loop) {
    var videos = loop.querySelectorAll("[data-video-loop-item]");
    if (!videos || videos.length < 2) return;

    videos.forEach(function (v) {
      v.muted = true;
      var p = v.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    });

    if (reduce) return;

    var HOLD_MS = 9000;
    var idx = 0;
    var timer = null;

    var tick = function () {
      var prev = videos[idx];
      idx = (idx + 1) % videos.length;
      var next = videos[idx];
      if (!next) return;
      var p = next.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
      next.classList.add("is-active");
      if (prev && prev !== next) {
        window.setTimeout(function () { prev.classList.remove("is-active"); }, 60);
      }
    };

    var start = function () { if (!timer) timer = window.setInterval(tick, HOLD_MS); };
    var stop  = function () { if (timer) { window.clearInterval(timer); timer = null; } };

    start();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });
  });
})();
