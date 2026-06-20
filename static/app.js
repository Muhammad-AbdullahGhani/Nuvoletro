const form = document.getElementById("upload-form");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const modePill = document.getElementById("mode-pill");
const submitBtn = document.getElementById("submit-btn");

let capabilities = { ffmpeg_available: false };

async function init() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    capabilities = data;
    if (data.mode === "live") {
      modePill.textContent = `Live · ${data.worker_count} workers · Whisper + Gemini + Chroma RAG`;
    } else {
      modePill.textContent = "Demo mode — add OPENAI_API_KEY + GEMINI_API_KEY in .env for full pipeline";
    }
  } catch {
    modePill.textContent = "API offline";
  }
}

function renderPlatform(el, pack, label) {
  const tags = (pack.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  el.innerHTML = `
    <h3>${label}</h3>
    <p><strong>Title</strong></p>
    <p>${escapeHtml(pack.title || "")}</p>
    <p><strong>Post / caption</strong></p>
    <pre>${escapeHtml(pack.description || "")}</pre>
    <p><strong>Hashtags</strong></p>
    <p>${escapeHtml(tags)}</p>
    <button type="button" class="copy btn secondary" data-copy="${escapeAttr(
      `${pack.title}\n\n${pack.description}\n\n${tags}`
    )}">Copy all</button>
  `;
  el.querySelector(".copy").addEventListener("click", (e) => {
    navigator.clipboard.writeText(e.target.dataset.copy);
    e.target.textContent = "Copied!";
    setTimeout(() => (e.target.textContent = "Copy all"), 1500);
  });
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return s.replace(/"/g, "&quot;");
}

function hasInput(fd) {
  const file = fd.get("file");
  const transcript = (fd.get("transcript") || "").toString().trim();
  const youtube = (fd.get("youtube_url") || "").toString().trim();
  return (file && file.size > 0) || transcript || youtube;
}

async function pollJob(jobId) {
  for (let i = 0; i < 180; i++) {
    const res = await fetch(`/api/jobs/${jobId}`);
    const job = await res.json();
    if (job.status === "completed" || job.status === "failed") return job;
    statusEl.textContent = `Processing (${job.status})… parallel workers running pipeline`;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Job timed out — check server logs");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.hidden = false;
  statusEl.classList.remove("error");
  statusEl.textContent = "Submitting job to worker pool…";
  submitBtn.disabled = true;
  resultsEl.hidden = true;

  const fd = new FormData(form);
  if (!hasInput(fd)) {
    statusEl.textContent = "Paste a YouTube URL, upload a file, or paste a transcript.";
    statusEl.classList.add("error");
    submitBtn.disabled = false;
    return;
  }
  const file = fd.get("file");
  if (file && file.size === 0) fd.delete("file");

  try {
    const res = await fetch("/api/jobs", { method: "POST", body: fd });
    let job = await res.json();
    if (!res.ok) throw new Error(job.detail || "Job submission failed");
    if (job.status === "pending" || job.status === "processing") {
      job = await pollJob(job.job_id);
    }
    if (job.status === "failed") throw new Error(job.error || "Job failed");
    showResults(job);
    statusEl.textContent = job.demo
      ? "Done (demo templates). Add API keys for Whisper + Gemini pipeline."
      : "Done! LinkedIn and Instagram posts ready to copy.";
  } catch (err) {
    statusEl.textContent = err.message || "Something went wrong";
    statusEl.classList.add("error");
  } finally {
    submitBtn.disabled = false;
  }
});

function showResults(job) {
  resultsEl.hidden = false;
  document.getElementById("transcript-out").textContent = job.transcript || "";
  const kit = job.content_kit || job.publish_kit;
  document.getElementById("srt-out").textContent = kit?.captions_srt || "";

  renderPlatform(document.getElementById("linkedin-box"), kit.linkedin, "LinkedIn");
  renderPlatform(document.getElementById("instagram-box"), kit.instagram, "Instagram");
  renderPlatform(document.getElementById("youtube-box"), kit.youtube, "YouTube");

  const ragDetails = document.getElementById("rag-details");
  const ragOut = document.getElementById("rag-out");
  if (kit.rag_context_used?.length) {
    ragDetails.hidden = false;
    ragOut.textContent = kit.rag_context_used.join("\n\n---\n\n");
  } else {
    ragDetails.hidden = true;
  }

  const clipsEl = document.getElementById("clips-out");
  clipsEl.innerHTML = "";
  const canExport = capabilities.ffmpeg_available && job.source_media;
  (kit.clip_suggestions || []).forEach((c, i) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${formatTime(c.start)} – ${formatTime(c.end)}: ${c.hook} (${c.reason})`;
    li.appendChild(label);
    if (canExport) {
      const a = document.createElement("a");
      a.className = "btn secondary clip-dl";
      a.href = `/api/jobs/${job.job_id}/clips/${i}`;
      a.textContent = "Export 9:16 clip";
      li.appendChild(a);
    }
    clipsEl.appendChild(li);
  });

  document.getElementById("dl-srt").href = `/api/jobs/${job.job_id}/download/srt`;
  document.getElementById("dl-json").href = `/api/jobs/${job.job_id}/download/json`;
  resultsEl.scrollIntoView({ behavior: "smooth" });
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

init();
