/**
 * Nuvoletro — Client-Side Application Engine
 * Handles interactive tabs, drag-and-drop ingestion, pipeline polling,
 * platform previews, and toast notifications.
 */

// Sample Demo Data Presets
const SAMPLE_SCRIPTS = {
  tech: `Welcome back to the channel. Today we're breaking down three fatal system design mistakes that destroy scalability in production backends.

Mistake number one: direct database coupling. When microservices share database instances, you lose isolated deployability and introduce massive cascading bottlenecks. Instead, use event-driven domain boundaries with decoupled read replicas.

Mistake number two: neglecting idempotent endpoints. Networks fail constantly. If your payment or mutation endpoints aren't strictly idempotent with idempotency keys, duplicate requests will create duplicate billing and corrupted data state.

Mistake number three: improper caching invalidation strategies. Creators and developers default to naive TTLs, which results in cache stampedes under high load. Always implement write-through or circuit-breaker caching with jitter.

Apply these three architectural rules to build high-scale, resilient backend systems. Let me know in the comments which pattern you're applying in your tech stack!`,

  marketing: `Stop posting the exact same content across all social media platforms. Here is the exact repurposing playbook top creators use to 10x their audience reach.

Step 1: Take your core long-form video or podcast and extract the 3 strongest rhetorical hooks in the first 30 seconds.
Step 2: Transform the key insights into a high-dwell-time LinkedIn post focused on contrarian industry lessons and actionable frameworks.
Step 3: Cut the highest energy 30-second segment into a vertical 9:16 video for Instagram Reels and YouTube Shorts with captions.

Creators who automate this workflow save 15+ hours every week while consistently growing their brand on multiple channels.`
};

const SAMPLE_YOUTUBE_URLS = {
  ai: {
    url: "https://www.youtube.com/watch?v=d_QVLD66Uq0",
    niche: "AI Engineering & LLMs"
  },
  saas: {
    url: "https://www.youtube.com/watch?v=0k1Pq6x4-Zk",
    niche: "SaaS Scaling & Growth"
  }
};

// Global App State
let appCapabilities = {
  ffmpeg_available: false,
  mode: "demo",
  worker_count: 4,
  openai_configured: false,
  gemini_configured: false
};

let currentJob = null;
let timerInterval = null;
let startTime = null;

// DOM Elements
const statusPill = document.getElementById("system-status-pill");
const statusPillText = document.getElementById("status-pill-text");
const sourceTabs = document.querySelectorAll(".source-tab");
const tabPanes = document.querySelectorAll(".tab-pane");
const platformTabs = document.querySelectorAll(".platform-tab");
const platformPanes = document.querySelectorAll(".platform-panel");
const repurposeForm = document.getElementById("repurpose-form");
const submitBtn = document.getElementById("submit-btn");
const submitBtnText = document.getElementById("submit-btn-text");
const pipelineProgress = document.getElementById("pipeline-progress");
const pipelineTimer = document.getElementById("pipeline-timer");
const pipelineTitle = document.getElementById("pipeline-title");
const pipelineDesc = document.getElementById("pipeline-desc");
const resultsHub = document.getElementById("results-hub");
const errorBox = document.getElementById("error-box");
const errorMessage = document.getElementById("error-message");

// Dropzone & File Input Elements
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

// Niche & Presets Elements
const nicheInput = document.getElementById("niche");
const nicheChips = document.querySelectorAll(".niche-chip");
const loadSampleBtn = document.getElementById("load-sample-btn");
const presetTechBtn = document.getElementById("preset-tech-btn");
const presetMarketingBtn = document.getElementById("preset-marketing-btn");
const quickSampleTags = document.querySelectorAll(".quick-sample-tag");
const startNewJobBtn = document.getElementById("start-new-job-btn");

// Toast Notification Manager
function showToast(message, icon = "✓") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
}

// 1. Initialize System Status
async function initSystem() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error("Health check failed");
    const data = await res.json();
    appCapabilities = data;

    if (data.mode === "live") {
      statusPill.className = "status-pill live";
      statusPillText.textContent = `🟢 Live Model · ${data.worker_count} Workers · Whisper + Gemini 2.0 Flash`;
    } else {
      statusPill.className = "status-pill demo";
      statusPillText.textContent = `🟡 Demo Mode · Template Engine (Add API Keys for Full Pipeline)`;
    }
  } catch (err) {
    statusPill.className = "status-pill";
    statusPillText.textContent = "🔴 API Offline · Start Uvicorn Server";
  }
}

// 2. Tab Navigation Handling
function setupTabs() {
  // Source Selection Tabs
  sourceTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      sourceTabs.forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      tabPanes.forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const targetPane = document.getElementById(`pane-${tab.dataset.tab}`);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // Results Platform Tabs
  platformTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      platformTabs.forEach((t) => t.classList.remove("active"));
      platformPanes.forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const targetPane = document.getElementById(`panel-${tab.dataset.platform}`);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // Transcript Subtabs (Segmented vs Raw SRT)
  const subtabBtns = document.querySelectorAll(".subtab-btn");
  subtabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      subtabBtns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".subtab-content").forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetSub = document.getElementById(`subtab-${btn.dataset.subtab}-view`);
      if (targetSub) targetSub.classList.add("active");
    });
  });
}

// 3. Dropzone & File Management
function setupDropzone() {
  if (!fileDropzone) return;

  ["dragenter", "dragover"].forEach((eventName) => {
    fileDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropzone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    fileDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropzone.classList.remove("drag-over");
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

  removeFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.value = "";
    dropzonePreview.style.display = "none";
    dropzoneIdle.style.display = "block";
  });
}

function handleFileSelected(file) {
  if (!file) return;
  previewFileName.textContent = file.name;
  const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
  previewFileSize.textContent = `${sizeMB} MB`;
  dropzoneIdle.style.display = "none";
  dropzonePreview.style.display = "block";
}

// 4. Transcript Counter & Sample Presets
function setupTranscriptTools() {
  if (!transcriptTextarea) return;

  transcriptTextarea.addEventListener("input", () => {
    const text = transcriptTextarea.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    transcriptWordCount.textContent = `${words} words`;
  });

  if (presetTechBtn) {
    presetTechBtn.addEventListener("click", () => {
      transcriptTextarea.value = SAMPLE_SCRIPTS.tech;
      transcriptTextarea.dispatchEvent(new Event("input"));
      nicheInput.value = "AI & Backend Engineering";
      showToast("Inserted AI Engineering sample script");
    });
  }

  if (presetMarketingBtn) {
    presetMarketingBtn.addEventListener("click", () => {
      transcriptTextarea.value = SAMPLE_SCRIPTS.marketing;
      transcriptTextarea.dispatchEvent(new Event("input"));
      nicheInput.value = "SaaS Growth & Marketing";
      showToast("Inserted SaaS Growth sample script");
    });
  }

  // Quick Niche Chips
  nicheChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      nicheChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      nicheInput.value = chip.dataset.val;
    });
  });

  // Quick YouTube Sample Tags
  quickSampleTags.forEach((tag) => {
    tag.addEventListener("click", () => {
      const input = document.getElementById("youtube_url");
      if (input) input.value = tag.dataset.sample;
      if (tag.dataset.niche) nicheInput.value = tag.dataset.niche;
      showToast(`Loaded sample URL: ${tag.dataset.niche}`);
    });
  });

  // Top Bar Sample Demo Button
  if (loadSampleBtn) {
    loadSampleBtn.addEventListener("click", () => {
      // Switch to transcript tab and insert tech sample
      const transcriptTab = document.querySelector('.source-tab[data-tab="transcript"]');
      if (transcriptTab) transcriptTab.click();
      transcriptTextarea.value = SAMPLE_SCRIPTS.tech;
      transcriptTextarea.dispatchEvent(new Event("input"));
      nicheInput.value = "AI Engineering";
      showToast("Loaded ready-to-run sample demo!");
    });
  }

  if (startNewJobBtn) {
    startNewJobBtn.addEventListener("click", () => {
      resultsHub.style.display = "none";
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
}

// 5. Timer & Progress Simulation
function startPipelineTimer() {
  startTime = Date.now();
  pipelineTimer.textContent = "00:00";
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    pipelineTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopPipelineTimer() {
  if (timerInterval) clearInterval(timerInterval);
}

function updatePipelineStep(stepName) {
  const steps = ["ingest", "transcribe", "rag", "generate"];
  const currentIndex = steps.indexOf(stepName);

  steps.forEach((step, idx) => {
    const el = document.getElementById(`step-${step}`);
    if (!el) return;
    const statusSpan = el.querySelector(".step-status");

    if (idx < currentIndex) {
      el.className = "step-item completed";
      if (statusSpan) statusSpan.textContent = "Done ✓";
    } else if (idx === currentIndex) {
      el.className = "step-item active";
      if (statusSpan) statusSpan.textContent = "Running…";
    } else {
      el.className = "step-item";
      if (statusSpan) statusSpan.textContent = "Pending";
    }
  });
}

// 6. Polling Worker Pipeline
async function pollJobStatus(jobId) {
  const maxAttempts = 120; // 3 minutes max
  let stepStage = 0;

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error("Failed to check job status");
    const job = await res.json();

    if (job.status === "processing") {
      if (i === 1) updatePipelineStep("transcribe");
      if (i === 4) updatePipelineStep("rag");
      if (i === 7) updatePipelineStep("generate");
    }

    if (job.status === "completed" || job.status === "failed") {
      return job;
    }

    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Job execution timed out. Please check backend server logs.");
}

// 7. Form Submission Handler
function setupFormSubmission() {
  if (!repurposeForm) return;

  repurposeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.style.display = "none";

    const fd = new FormData(repurposeForm);
    const activeTab = document.querySelector(".source-tab.active")?.dataset.tab;

    // Filter FormData based on active tab
    if (activeTab === "youtube") {
      fd.delete("file");
      fd.delete("transcript");
      const ytUrl = (fd.get("youtube_url") || "").toString().trim();
      if (!ytUrl) {
        showError("Please enter a valid YouTube video or shorts URL.");
        return;
      }
    } else if (activeTab === "upload") {
      fd.delete("youtube_url");
      fd.delete("transcript");
      const file = fd.get("file");
      if (!file || file.size === 0) {
        showError("Please select or drop a video/audio file to upload.");
        return;
      }
    } else if (activeTab === "transcript") {
      fd.delete("youtube_url");
      fd.delete("file");
      const txt = (fd.get("transcript") || "").toString().trim();
      if (!txt) {
        showError("Please enter or paste transcript/script text.");
        return;
      }
    }

    // Lock UI and show progress
    submitBtn.disabled = true;
    submitBtnText.textContent = "Processing Pipeline…";
    pipelineProgress.style.display = "block";
    resultsHub.style.display = "none";
    updatePipelineStep("ingest");
    startPipelineTimer();

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        body: fd
      });

      let job = await res.json();
      if (!res.ok) {
        throw new Error(job.detail || "Failed to submit job to worker pool.");
      }

      if (job.status === "pending" || job.status === "processing") {
        job = await pollJobStatus(job.job_id);
      }

      if (job.status === "failed") {
        throw new Error(job.error || "Content repurposing failed during execution.");
      }

      // Finalize Pipeline
      updatePipelineStep("generate");
      document.getElementById("step-generate").className = "step-item completed";
      document.getElementById("step-generate").querySelector(".step-status").textContent = "Done ✓";

      currentJob = job;
      renderContentKit(job);
      showToast("Content kit ready to publish!", "✨");
    } catch (err) {
      showError(err.message || "An unexpected error occurred.");
    } finally {
      stopPipelineTimer();
      submitBtn.disabled = false;
      submitBtnText.textContent = "Generate Content Kit";
      pipelineProgress.style.display = "none";
    }
  });
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorBox.style.display = "flex";
  errorBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// 8. Render Results Content Hub
function renderContentKit(job) {
  resultsHub.style.display = "block";
  const kit = job.content_kit || job.publish_kit;
  if (!kit) return;

  // Metadata tags
  document.getElementById("res-mode-tag").textContent = job.demo ? "Demo Mode (Templates)" : "Live Model (Gemini 2.0)";
  document.getElementById("res-niche-tag").textContent = job.niche || "General Content";
  document.getElementById("res-source-meta").textContent = job.filename ? `Source: ${job.filename}` : "Source: Raw Input";

  // 1. LinkedIn Post
  const liTitle = kit.linkedin.title || "LinkedIn Post";
  const liDesc = kit.linkedin.description || "";
  const liTags = (kit.linkedin.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`));
  
  document.getElementById("linkedin-title").textContent = liTitle;
  document.getElementById("linkedin-description").textContent = liDesc;
  document.getElementById("linkedin-hashtags").innerHTML = liTags
    .map((tag) => `<span class="hashtag-pill">${escapeHtml(tag)}</span>`)
    .join("");
  document.getElementById("linkedin-post-content").value = `${liTitle}\n\n${liDesc}\n\n${liTags.join(" ")}`;

  // 2. Instagram Caption
  const igTitle = kit.instagram.title || "Instagram Reel Hook";
  const igDesc = kit.instagram.description || "";
  const igTags = (kit.instagram.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`));

  document.getElementById("instagram-title").textContent = igTitle;
  document.getElementById("instagram-description").textContent = igDesc;
  document.getElementById("instagram-hashtags").innerHTML = igTags
    .map((tag) => `<span class="hashtag-pill">${escapeHtml(tag)}</span>`)
    .join("");
  document.getElementById("instagram-post-content").value = `${igTitle}\n\n${igDesc}\n\n${igTags.join(" ")}`;

  // 3. YouTube Optimization
  const ytTitle = kit.youtube.title || "";
  const ytDesc = kit.youtube.description || "";
  const ytTags = [...(kit.youtube.hashtags || []), ...((kit.youtube.extra && kit.youtube.extra.tags) || [])];

  document.getElementById("youtube-title").textContent = ytTitle;
  document.getElementById("yt-title-count").textContent = ytTitle.length;
  document.getElementById("youtube-description").textContent = ytDesc;
  document.getElementById("youtube-tags").innerHTML = ytTags
    .map((tag) => `<span class="hashtag-pill">${escapeHtml(tag)}</span>`)
    .join("");
  document.getElementById("youtube-post-content").value = `Title: ${ytTitle}\n\nDescription:\n${ytDesc}\n\nTags:\n${ytTags.join(", ")}`;

  // 4. Transcript & SRT Preview
  document.getElementById("transcript-raw-text").value = job.transcript || "";
  document.getElementById("srt-raw-preview").textContent = kit.captions_srt || "No SRT subtitle available";

  const segmentsContainer = document.getElementById("transcript-segments-list");
  segmentsContainer.innerHTML = "";
  if (job.segments && job.segments.length > 0) {
    job.segments.forEach((seg) => {
      const row = document.createElement("div");
      row.className = "segment-row";
      row.innerHTML = `
        <span class="segment-timecode">${formatSeconds(seg.start)}</span>
        <span class="segment-text">${escapeHtml(seg.text)}</span>
      `;
      segmentsContainer.appendChild(row);
    });
  } else {
    segmentsContainer.innerHTML = `<p class="empty-state-text">${escapeHtml(job.transcript || "No segments")}</p>`;
  }

  // 5. RAG Insights Chunks
  const ragContainer = document.getElementById("rag-insights-container");
  ragContainer.innerHTML = "";
  if (kit.rag_context_used && kit.rag_context_used.length > 0) {
    kit.rag_context_used.forEach((chunk) => {
      const card = document.createElement("div");
      card.className = "rag-chunk-card";
      card.textContent = chunk;
      ragContainer.appendChild(card);
    });
  } else {
    ragContainer.innerHTML = `<p class="empty-state-text">No custom RAG playbook chunks needed for this generation.</p>`;
  }

  // 6. Viral Clip Suggestions
  const clipsContainer = document.getElementById("clips-list-container");
  const clipBadge = document.getElementById("clip-count-badge");
  clipsContainer.innerHTML = "";

  const clips = kit.clip_suggestions || [];
  clipBadge.textContent = `${clips.length} clips`;

  const canExportVideo = appCapabilities.ffmpeg_available && Boolean(job.source_media);

  if (clips.length === 0) {
    clipsContainer.innerHTML = `<p class="empty-state-text">No distinct hook clips identified.</p>`;
  } else {
    clips.forEach((clip, index) => {
      const durationSec = Math.round(clip.end - clip.start);
      const card = document.createElement("div");
      card.className = "clip-item-card";

      let exportBtnHtml = "";
      if (canExportVideo) {
        exportBtnHtml = `
          <a href="/api/jobs/${job.job_id}/clips/${index}?vertical=true" class="btn-export-clip" target="_blank" download>
            <span>📱</span> Export 9:16 Reel
          </a>
        `;
      } else {
        exportBtnHtml = `
          <span class="btn-export-clip disabled" title="Upload a video file with FFmpeg installed to export clips">
            <span>⏱️</span> ${durationSec}s Segment
          </span>
        `;
      }

      card.innerHTML = `
        <div class="clip-card-top">
          <span class="clip-duration-badge">${formatSeconds(clip.start)} – ${formatSeconds(clip.end)} (${durationSec}s)</span>
          <span class="clip-reason-tag">${escapeHtml(clip.reason || "Viral Moment")}</span>
        </div>
        <p class="clip-hook-quote">"${escapeHtml(clip.hook || "")}"</p>
        <div class="clip-actions">
          ${exportBtnHtml}
        </div>
      `;
      clipsContainer.appendChild(card);
    });
  }

  // Set Download Links
  document.getElementById("dl-srt-btn").href = `/api/jobs/${job.job_id}/download/srt`;
  document.getElementById("dl-json-btn").href = `/api/jobs/${job.job_id}/download/json`;

  // Scroll smoothly to results
  resultsHub.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 9. Copy Actions Management
function setupCopyActions() {
  document.querySelectorAll(".btn-copy, .btn-copy-sm").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.copyTarget;
      let textToCopy = "";

      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        textToCopy = targetEl.value || targetEl.textContent;
      }

      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy.trim());
        btn.classList.add("copied");
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span>✓</span> Copied!`;
        showToast("Copied content to clipboard!");
        setTimeout(() => {
          btn.classList.remove("copied");
          btn.innerHTML = originalText;
        }, 1800);
      }
    });
  });

  const copyAllBtn = document.getElementById("copy-all-btn");
  if (copyAllBtn) {
    copyAllBtn.addEventListener("click", () => {
      if (!currentJob) return;
      const kit = currentJob.content_kit || currentJob.publish_kit;
      if (!kit) return;

      const combinedText = `--- LINKEDIN POST ---
${kit.linkedin.title}

${kit.linkedin.description}
${(kit.linkedin.hashtags || []).join(" ")}

--- INSTAGRAM REELS CAPTION ---
${kit.instagram.title}

${kit.instagram.description}
${(kit.instagram.hashtags || []).join(" ")}

--- YOUTUBE SEO METADATA ---
Title: ${kit.youtube.title}

Description:
${kit.youtube.description}

Tags: ${(kit.youtube.hashtags || []).join(", ")}`;

      navigator.clipboard.writeText(combinedText);
      showToast("Copied all platform posts to clipboard!");
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

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Startup Initialization
document.addEventListener("DOMContentLoaded", () => {
  initSystem();
  setupTabs();
  setupDropzone();
  setupTranscriptTools();
  setupFormSubmission();
  setupCopyActions();
});
