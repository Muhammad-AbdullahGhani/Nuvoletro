/**
 * Nuvoletro — Content Transformation Engine
 * Handles specimen switching, workbench ingestion, asynchronous worker polling,
 * platform-branded output rendering, and copy toasts.
 */

// Sample Preset Scripts
const SAMPLES = {
  tech: `Welcome back everyone. Today we're breaking down three fatal caching mistakes that break production backends under high load.

Mistake number one: naive TTLs. When all your keys expire at the exact same second, you trigger a massive cache stampede that overwhelms the database. Instead, add jitter by randomizing expiration times by plus or minus ten percent.

Mistake number two: neglecting write-through invalidation. If you rely purely on eventual time-based expiration for mutating state, users will see stale or corrupted records during peak transactions.

Mistake number three: no circuit breakers on cache misses. Always protect origin databases from cascading outages.

Apply these three architectural rules to build high-scale, resilient backend systems. Let me know in the comments which pattern you're applying in your tech stack!`,

  saas: `Stop posting the exact same content across all social media platforms. Here is the exact repurposing playbook top creators use to 10x their audience reach.

Step 1: Take your core long-form video or podcast and extract the 3 strongest rhetorical hooks in the first 30 seconds.
Step 2: Transform the key insights into a high-dwell-time LinkedIn post focused on contrarian industry lessons and actionable frameworks.
Step 3: Cut the highest energy 30-second segment into a vertical 9:16 video for Instagram Reels and YouTube Shorts with captions.

Creators who automate this workflow save 15+ hours every week while consistently growing their brand on multiple channels.`
};

// Global App State
let systemCapabilities = {
  ffmpeg_available: false,
  mode: "demo",
  worker_count: 4,
  openai_configured: false,
  gemini_configured: false
};

let currentJob = null;
let timerHandle = null;
let startTimeEpoch = null;

// DOM Elements
const statusBeacon = document.getElementById("status-beacon");
const statusText = document.getElementById("status-text");
const statusContainer = document.querySelector(".system-status-indicator");

const specimenTabs = document.querySelectorAll(".specimen-tab");
const specimenViews = document.querySelectorAll(".specimen-view");

const modeTabs = document.querySelectorAll(".mode-tab");
const formPanes = document.querySelectorAll(".form-pane");

const repurposeForm = document.getElementById("repurpose-form");
const submitBtn = document.getElementById("submit-btn");
const submitBtnText = document.getElementById("submit-btn-text");

const executionTracker = document.getElementById("execution-tracker");
const trackerTimer = document.getElementById("tracker-timer");
const trackerTitle = document.getElementById("tracker-title");
const trackerDesc = document.getElementById("tracker-desc");

const errorBanner = document.getElementById("error-banner");
const errorMessageText = document.getElementById("error-message-text");

const resultsHub = document.getElementById("results-hub");
const resetWorkbenchBtn = document.getElementById("reset-workbench-btn");

// File Upload Dropzone Elements
const fileDropzone = document.getElementById("file-dropzone");
const fileInput = document.getElementById("file-input");
const dropzoneIdle = document.getElementById("dropzone-idle");
const dropzonePreview = document.getElementById("dropzone-preview");
const previewFileName = document.getElementById("preview-file-name");
const previewFileSize = document.getElementById("preview-file-size");
const removeFileBtn = document.getElementById("remove-file-btn");

// Transcript Elements
const transcriptTextarea = document.getElementById("transcript-text");
const transcriptWordCount = document.getElementById("transcript-word-count");

// Presets & Niche
const nicheInput = document.getElementById("niche");
const nicheTags = document.querySelectorAll(".niche-tag");
const insertTechSampleBtn = document.getElementById("insert-tech-sample");
const insertSaasSampleBtn = document.getElementById("insert-saas-sample");
const quickPresetBtns = document.querySelectorAll(".quick-preset-btn");

// Toast Notification Manager
function notify(msg) {
  const shelf = document.getElementById("toast-shelf");
  if (!shelf) return;
  const item = document.createElement("div");
  item.className = "toast-item";
  item.innerHTML = `<span>✓</span><span>${msg}</span>`;
  shelf.appendChild(item);
  setTimeout(() => {
    if (item.parentNode) item.parentNode.removeChild(item);
  }, 2800);
}

// 1. Initialize System Health Status
async function initSystemStatus() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error("Health check failed");
    const data = await res.json();
    systemCapabilities = data;

    if (data.mode === "live") {
      statusContainer.className = "system-status-indicator live";
      statusText.textContent = `Live Model · ${data.worker_count} Workers · Whisper + Gemini`;
    } else {
      statusContainer.className = "system-status-indicator demo";
      statusText.textContent = `Demo Mode (Add API Keys for Live AI)`;
    }
  } catch (err) {
    statusContainer.className = "system-status-indicator";
    statusText.textContent = "API Offline";
  }
}

// 2. Setup Specimen Tabs (Before / After Showcase)
function setupSpecimenTabs() {
  specimenTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      specimenTabs.forEach((t) => t.classList.remove("active"));
      specimenViews.forEach((v) => v.classList.remove("active"));

      tab.classList.add("active");
      const targetView = document.getElementById(`specimen-${tab.dataset.specimen}`);
      if (targetView) targetView.classList.add("active");
    });
  });
}

// 3. Setup Workbench Mode Tabs
function setupWorkbenchTabs() {
  modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      modeTabs.forEach((t) => t.classList.remove("active"));
      formPanes.forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const targetPane = document.getElementById(`pane-${tab.dataset.tab}`);
      if (targetPane) targetPane.classList.add("active");
    });
  });
}

// 4. Setup Upload Dropzone
function setupDropzone() {
  if (!fileDropzone) return;

  ["dragenter", "dragover"].forEach((evt) => {
    fileDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      fileDropzone.classList.add("drag-active");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    fileDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      fileDropzone.classList.remove("drag-active");
    });
  });

  fileDropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelected(fileInput.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  if (removeFileBtn) {
    removeFileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.value = "";
      dropzonePreview.style.display = "none";
      dropzoneIdle.style.display = "block";
    });
  }
}

function handleFileSelected(file) {
  if (!file) return;
  previewFileName.textContent = file.name;
  const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
  previewFileSize.textContent = `${sizeMB} MB`;
  dropzoneIdle.style.display = "none";
  dropzonePreview.style.display = "block";
}

// 5. Setup Presets & Transcript Tools
function setupPresets() {
  if (transcriptTextarea) {
    transcriptTextarea.addEventListener("input", () => {
      const text = transcriptTextarea.value.trim();
      const count = text ? text.split(/\s+/).length : 0;
      transcriptWordCount.textContent = `${count} words`;
    });
  }

  if (insertTechSampleBtn) {
    insertTechSampleBtn.addEventListener("click", () => {
      transcriptTextarea.value = SAMPLES.tech;
      transcriptTextarea.dispatchEvent(new Event("input"));
      nicheInput.value = "AI & Backend Engineering";
      notify("Inserted AI Architecture script");
    });
  }

  if (insertSaasSampleBtn) {
    insertSaasSampleBtn.addEventListener("click", () => {
      transcriptTextarea.value = SAMPLES.saas;
      transcriptTextarea.dispatchEvent(new Event("input"));
      nicheInput.value = "Content Strategy & SaaS Growth";
      notify("Inserted Repurposing script");
    });
  }

  // Niche Tags
  nicheTags.forEach((tag) => {
    tag.addEventListener("click", () => {
      nicheTags.forEach((t) => t.classList.remove("active"));
      tag.classList.add("active");
      nicheInput.value = tag.dataset.val;
    });
  });

  // Quick Preset YouTube Links
  quickPresetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const urlInput = document.getElementById("youtube_url");
      if (urlInput && btn.dataset.url) {
        urlInput.value = btn.dataset.url;
      }
      if (btn.dataset.niche) {
        nicheInput.value = btn.dataset.niche;
      }
      notify(`Loaded: ${btn.dataset.niche || "Sample URL"}`);
    });
  });

  if (resetWorkbenchBtn) {
    resetWorkbenchBtn.addEventListener("click", () => {
      resultsHub.style.display = "none";
      const target = document.getElementById("studio-workbench");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

// 6. Tracker Timer & Stepper Progression
function startTimer() {
  startTimeEpoch = Date.now();
  trackerTimer.textContent = "00:00";
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTimeEpoch) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    trackerTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
}

function setStep(stepName) {
  const steps = ["ingest", "transcribe", "rag", "generate"];
  const targetIdx = steps.indexOf(stepName);

  steps.forEach((s, idx) => {
    const el = document.getElementById(`track-${s}`);
    if (!el) return;
    if (idx < targetIdx) {
      el.className = "track-step completed";
    } else if (idx === targetIdx) {
      el.className = "track-step active";
    } else {
      el.className = "track-step";
    }
  });
}

// 7. Polling Worker Pipeline
async function pollJob(jobId) {
  const maxAttempts = 120;

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error("Could not fetch job status");
    const job = await res.json();

    if (job.status === "processing") {
      if (i === 1) setStep("transcribe");
      if (i === 4) setStep("rag");
      if (i === 7) setStep("generate");
    }

    if (job.status === "completed" || job.status === "failed") {
      return job;
    }

    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Job timed out while processing");
}

// 8. Form Submission
function setupForm() {
  if (!repurposeForm) return;

  repurposeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBanner.style.display = "none";

    const fd = new FormData(repurposeForm);
    const activeTab = document.querySelector(".mode-tab.active")?.dataset.tab;

    if (activeTab === "youtube") {
      fd.delete("file");
      fd.delete("transcript");
      const url = (fd.get("youtube_url") || "").toString().trim();
      if (!url) {
        showError("Please enter a YouTube video URL.");
        return;
      }
    } else if (activeTab === "upload") {
      fd.delete("youtube_url");
      fd.delete("transcript");
      const file = fd.get("file");
      if (!file || file.size === 0) {
        showError("Please select or drop an audio/video file.");
        return;
      }
    } else if (activeTab === "transcript") {
      fd.delete("youtube_url");
      fd.delete("file");
      const text = (fd.get("transcript") || "").toString().trim();
      if (!text) {
        showError("Please paste or write transcript text.");
        return;
      }
    }

    // Lock UI and show tracker
    submitBtn.disabled = true;
    submitBtnText.textContent = "Transforming…";
    executionTracker.style.display = "block";
    resultsHub.style.display = "none";
    setStep("ingest");
    startTimer();

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        body: fd
      });

      let job = await res.json();
      if (!res.ok) {
        throw new Error(job.detail || "Submission failed");
      }

      if (job.status === "pending" || job.status === "processing") {
        job = await pollJob(job.job_id);
      }

      if (job.status === "failed") {
        throw new Error(job.error || "Transformation failed");
      }

      setStep("generate");
      document.getElementById("track-generate").className = "track-step completed";

      currentJob = job;
      renderContentHub(job);
      notify("Content kit ready!");
    } catch (err) {
      showError(err.message || "An unexpected error occurred.");
    } finally {
      stopTimer();
      submitBtn.disabled = false;
      submitBtnText.textContent = "Transform Media Into Content Kit";
      executionTracker.style.display = "none";
    }
  });
}

function showError(msg) {
  errorMessageText.textContent = msg;
  errorBanner.style.display = "flex";
  errorBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// 9. Render Platform-Branded Output Cards
function renderContentHub(job) {
  resultsHub.style.display = "block";
  const kit = job.content_kit || job.publish_kit;
  if (!kit) return;

  // Metadata chips
  document.getElementById("res-mode-chip").textContent = job.demo ? "Demo Mode (Templates)" : "Live Model (Gemini 2.0)";
  document.getElementById("res-niche-chip").textContent = job.niche || "General Content";
  document.getElementById("res-source-chip").textContent = job.filename ? `Source: ${job.filename}` : "Source: Raw Input";

  // 1. LinkedIn Card
  const liTitle = kit.linkedin.title || "LinkedIn Insight";
  const liDesc = kit.linkedin.description || "";
  const liTags = (kit.linkedin.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`));

  document.getElementById("out-linkedin-title").textContent = liTitle;
  document.getElementById("out-linkedin-desc").textContent = liDesc;
  document.getElementById("out-linkedin-tags").innerHTML = liTags
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");
  document.getElementById("linkedin-payload").value = `${liTitle}\n\n${liDesc}\n\n${liTags.join(" ")}`;

  // 2. Instagram Card
  const igTitle = kit.instagram.title || "Reel Hook";
  const igDesc = kit.instagram.description || "";
  const igTags = (kit.instagram.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`));

  document.getElementById("out-instagram-title").textContent = igTitle;
  document.getElementById("out-instagram-desc").textContent = igDesc;
  document.getElementById("out-instagram-tags").innerHTML = igTags
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");
  document.getElementById("instagram-payload").value = `${igTitle}\n\n${igDesc}\n\n${igTags.join(" ")}`;

  // 3. YouTube Card
  const ytTitle = kit.youtube.title || "";
  const ytDesc = kit.youtube.description || "";
  const ytTags = [...(kit.youtube.hashtags || []), ...((kit.youtube.extra && kit.youtube.extra.tags) || [])];

  document.getElementById("out-youtube-title").textContent = ytTitle;
  document.getElementById("out-yt-count").textContent = ytTitle.length;
  document.getElementById("out-youtube-desc").textContent = ytDesc;
  document.getElementById("out-youtube-tags").innerHTML = ytTags
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");
  document.getElementById("youtube-payload").value = `Title: ${ytTitle}\n\nDescription:\n${ytDesc}\n\nTags:\n${ytTags.join(", ")}`;

  // 4. Viral Short Clips & 9:16 Video Export
  const clipsContainer = document.getElementById("out-clips-list");
  const clipsBadge = document.getElementById("out-clips-badge");
  clipsContainer.innerHTML = "";

  const clips = kit.clip_suggestions || [];
  clipsBadge.textContent = `${clips.length} clips`;
  const canExport = systemCapabilities.ffmpeg_available && Boolean(job.source_media);

  if (clips.length === 0) {
    clipsContainer.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;">No distinct clips generated.</p>`;
  } else {
    clips.forEach((clip, idx) => {
      const dur = Math.round(clip.end - clip.start);
      const slice = document.createElement("div");
      slice.className = "clip-slice-card";

      let exportBtn = "";
      if (canExport) {
        exportBtn = `<a href="/api/jobs/${job.job_id}/clips/${idx}?vertical=true" class="btn-export-reel" target="_blank" download><span>📱</span> Export 9:16 Reel</a>`;
      } else {
        exportBtn = `<span class="btn-export-reel disabled"><span>⏱️</span> ${dur}s Segment</span>`;
      }

      slice.innerHTML = `
        <div class="clip-slice-header">
          <span class="clip-time-tag">${formatTime(clip.start)} – ${formatTime(clip.end)} (${dur}s)</span>
          <span class="clip-reason-pill">${escapeHtml(clip.reason || "Viral Moment")}</span>
        </div>
        <p class="clip-quote">"${escapeHtml(clip.hook || "")}"</p>
        <div>${exportBtn}</div>
      `;
      clipsContainer.appendChild(slice);
    });
  }

  // 5. Transcript Timeline
  document.getElementById("transcript-payload").value = job.transcript || "";
  const timeline = document.getElementById("out-transcript-timeline");
  timeline.innerHTML = "";

  if (job.segments && job.segments.length > 0) {
    job.segments.forEach((seg) => {
      const row = document.createElement("div");
      row.className = "timeline-row";
      row.innerHTML = `
        <span class="timeline-stamp">${formatTime(seg.start)}</span>
        <span class="timeline-speech">${escapeHtml(seg.text)}</span>
      `;
      timeline.appendChild(row);
    });
  } else {
    timeline.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;">${escapeHtml(job.transcript || "No segments recorded")}</p>`;
  }

  // Download Link URLs
  document.getElementById("dl-srt-btn").href = `/api/jobs/${job.job_id}/download/srt`;
  document.getElementById("dl-json-btn").href = `/api/jobs/${job.job_id}/download/json`;

  // Scroll smoothly to output
  resultsHub.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 10. Copy Handlers
function setupCopyActions() {
  document.querySelectorAll(".btn-copy-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const target = document.getElementById(targetId);
      if (target && target.value) {
        navigator.clipboard.writeText(target.value.trim());
        btn.classList.add("copied");
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span>✓</span> Copied!`;
        notify("Copied post to clipboard!");
        setTimeout(() => {
          btn.classList.remove("copied");
          btn.innerHTML = originalText;
        }, 1600);
      }
    });
  });

  const copyAllBtn = document.getElementById("copy-all-btn");
  if (copyAllBtn) {
    copyAllBtn.addEventListener("click", () => {
      if (!currentJob) return;
      const kit = currentJob.content_kit || currentJob.publish_kit;
      if (!kit) return;

      const fullText = `=== LINKEDIN POST ===
${kit.linkedin.title}

${kit.linkedin.description}
${(kit.linkedin.hashtags || []).join(" ")}

=== INSTAGRAM REELS CAPTION ===
${kit.instagram.title}

${kit.instagram.description}
${(kit.instagram.hashtags || []).join(" ")}

=== YOUTUBE METADATA ===
Title: ${kit.youtube.title}

Description:
${kit.youtube.description}

Tags: ${(kit.youtube.hashtags || []).join(", ")}`;

      navigator.clipboard.writeText(fullText);
      notify("Copied all platform outputs to clipboard!");
    });
  }
}

// Utilities
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Launch
document.addEventListener("DOMContentLoaded", () => {
  initSystemStatus();
  setupSpecimenTabs();
  setupWorkbenchTabs();
  setupDropzone();
  setupPresets();
  setupForm();
  setupCopyActions();
});
