"use strict";

const FILTERS = {
  original: "none",
  vintage: "sepia(0.55) contrast(0.92) saturate(0.82)",
  grayscale: "grayscale(1)",
  warm: "saturate(1.2) sepia(0.18) hue-rotate(-8deg)",
  cool: "saturate(0.92) hue-rotate(12deg) brightness(1.03)"
};

const MAX_PHOTOS = 8;
const PHOTO_DATABASE = "snapspot";
const PHOTO_STORE = "photos";
const PHOTO_DATABASE_VERSION = 1;
const POSE_IDEAS = [
  "Give your best red-carpet wave.",
  "Strike a silly superhero pose.",
  "Look over your shoulder like a movie star.",
  "Make a tiny heart with your hands.",
  "Show off your biggest, goofiest grin.",
  "Pretend you just heard the best news ever.",
  "Pose like you're on the cover of an album.",
  "Throw up a peace sign and lean in.",
  "Give the camera your most mysterious look.",
  "Make a star shape with your arms."
];
const video = document.querySelector("#video");
const videoFrame = document.querySelector("#video-frame");
const placeholder = document.querySelector("#video-placeholder");
const placeholderTitle = document.querySelector("#placeholder-title");
const placeholderCopy = document.querySelector("#placeholder-copy");
const startButton = document.querySelector("#start-camera");
const switchButton = document.querySelector("#switch-camera");
const captureButton = document.querySelector("#capture-button");
const captureLabel = document.querySelector("#capture-label");
const cameraLabel = document.querySelector("#camera-label");
const liveDot = document.querySelector("#live-dot");
const cameraHint = document.querySelector("#camera-hint");
const cameraError = document.querySelector("#camera-error");
const countdownOverlay = document.querySelector("#countdown-overlay");
const flashOverlay = document.querySelector("#flash-overlay");
const canvas = document.querySelector("#photo-canvas");
const galleryGrid = document.querySelector("#gallery-grid");
const galleryEmpty = document.querySelector("#gallery-empty");
const photoCount = document.querySelector("#photo-count");
const poseIdea = document.querySelector("#pose-idea");
const surpriseButton = document.querySelector("#surprise-button");
const storageStatus = document.querySelector("#storage-status");

let stream = null;
let activeFilter = "original";
let countdownSeconds = 5;
let isCapturing = false;
let isStartingCamera = false;
let cameraFacing = "user";
let activeDeviceId = null;
let cameraDevices = [];
let captureTimeout = null;
let photoNumber = 0;
let previousPoseIndex = -1;
let photoStorageReady = false;
let photoStorageError = null;
let photoStorageReadyPromise;

function setCameraError(message) {
  cameraError.textContent = message;
  cameraError.hidden = !message;
}

function cameraErrorMessage(error) {
  if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
    return "Camera permission was blocked. Allow camera access in your browser’s address-bar or site settings, then try again.";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "No camera was found. Connect a camera and try again.";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "Your camera couldn’t start. It may be in use by another app—close that app and try again.";
  }
  if (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError") {
    return "That camera isn’t available right now. Try switching cameras or reconnecting it.";
  }
  if (error.name === "SecurityError" || !window.isSecureContext) {
    return "Camera access requires a secure connection. Open this page on HTTPS or localhost, then try again.";
  }
  return "We couldn’t start your camera. Check your browser’s camera settings and try again.";
}

function updateCameraControls(isReady) {
  const canSwitch = cameraDevices.length > 1 || Boolean(navigator.mediaDevices?.getSupportedConstraints?.()?.facingMode);
  switchButton.hidden = !isReady || !canSwitch;
  switchButton.disabled = isStartingCamera || isCapturing;
  const targetFacing = cameraFacing === "user" ? "environment" : "user";
  const targetCameraName = targetFacing === "user" ? "front" : "rear";
  switchButton.setAttribute("aria-label", `Switch to ${targetCameraName} camera`);
  switchButton.title = `Switch to ${targetCameraName} camera`;
  captureButton.disabled = !isReady || isCapturing || isStartingCamera || !photoStorageReady;
  startButton.querySelector("span").textContent = isReady ? "Camera is on" : "Try camera again";
  startButton.disabled = isReady || isStartingCamera;
  if (isReady) {
    cameraLabel.textContent = isStartingCamera
      ? "SWITCHING CAMERA"
      : cameraFacing === "environment" ? "REAR CAMERA IS ON" : "FRONT CAMERA IS ON";
    liveDot.classList.add("is-live");
    placeholder.hidden = true;
    cameraHint.textContent = canSwitch
      ? `Tap the arrows to switch to the ${targetCameraName} camera.`
      : "Camera access stays on your device.";
  } else {
    cameraLabel.textContent = "CAMERA IS OFF";
    liveDot.classList.remove("is-live");
    placeholder.hidden = false;
    cameraHint.textContent = "Camera access stays on your device.";
  }
}

async function refreshCameraDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    cameraDevices = [];
    return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  cameraDevices = devices.filter((device) => device.kind === "videoinput");
}

function findCameraForFacing(facingMode) {
  const pattern = facingMode === "environment"
    ? /back|rear|environment|world/
    : /front|user|facetime|built.?in/;
  return cameraDevices.find((device) => pattern.test(device.label.toLowerCase()));
}

async function startCamera(options = {}) {
  if (isStartingCamera) return false;
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraError(
      window.isSecureContext
        ? "Camera access isn’t supported by this browser. Try a current version of Chrome, Firefox, Safari, or Edge."
        : cameraErrorMessage({ name: "SecurityError" })
    );
    return false;
  }

  isStartingCamera = true;
  updateCameraControls(Boolean(stream));
  startButton.disabled = true;
  startButton.querySelector("span").textContent = "Connecting…";
  if (!stream) {
    placeholderTitle.textContent = "Getting your spotlight ready…";
    placeholderCopy.textContent = "Your browser will ask you to allow camera access.";
  }
  setCameraError("");

  let newStream;
  try {
    const facingMode = options.facingMode || "user";
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: options.allowDeviceFallback
          ? { facingMode: { exact: facingMode } }
          : { facingMode: { ideal: facingMode } }
      });
    } catch (facingError) {
      if (options.allowDeviceFallback) {
        await refreshCameraDevices();
        const targetDevice = findCameraForFacing(facingMode);
        if (!targetDevice) throw facingError;
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: targetDevice.deviceId } }
        });
      } else if (facingError.name === "OverconstrainedError" || facingError.name === "TypeError") {
        newStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } else {
        throw facingError;
      }
    }
  } catch (error) {
    isStartingCamera = false;
    placeholderTitle.textContent = "Your spotlight is waiting";
    placeholderCopy.textContent = "Allow camera access to see your live preview and get started.";
    updateCameraControls(Boolean(stream));
    setCameraError(cameraErrorMessage(error));
    return false;
  }

  let devicesUnavailable = false;
  try {
    await refreshCameraDevices();
  } catch {
    cameraDevices = [];
    devicesUnavailable = true;
  }

  const previousStream = stream;
  const previousDeviceId = activeDeviceId;
  const previousFacing = cameraFacing;
  stream = newStream;
  video.srcObject = stream;
  const trackSettings = stream.getVideoTracks()[0]?.getSettings() || {};
  activeDeviceId = trackSettings.deviceId || options.deviceId || null;
  cameraFacing = trackSettings.facingMode === "user" || trackSettings.facingMode === "environment"
    ? trackSettings.facingMode
    : options.facingMode || "user";
  videoFrame.dataset.facing = cameraFacing;
  video.style.filter = FILTERS[activeFilter];
  stream.getVideoTracks().forEach((track) => {
    track.addEventListener("ended", () => {
      if (stream !== newStream) return;
      stream = null;
      video.srcObject = null;
      updateCameraControls(false);
      setCameraError("Your camera disconnected. Reconnect it and try again.");
    }, { once: true });
  });

  try {
    await video.play();
  } catch (error) {
    newStream.getTracks().forEach((track) => track.stop());
    stream = previousStream;
    activeDeviceId = previousDeviceId;
    cameraFacing = previousFacing;
    videoFrame.dataset.facing = cameraFacing;
    video.srcObject = previousStream;
    if (previousStream) {
      try {
        await video.play();
      } catch {
        previousStream.getTracks().forEach((track) => track.stop());
        stream = null;
        video.srcObject = null;
      }
    }
    isStartingCamera = false;
    updateCameraControls(Boolean(stream));
    setCameraError("The camera connected, but the preview couldn’t start. Check your browser settings and try again.");
    return false;
  }

  if (previousStream) previousStream.getTracks().forEach((track) => track.stop());
  isStartingCamera = false;
  placeholderTitle.textContent = "Your spotlight is waiting";
  placeholderCopy.textContent = "Allow camera access to see your live preview and get started.";
  updateCameraControls(true);
  if (devicesUnavailable) {
    setCameraError("Your camera is on, but we couldn’t check for other available cameras.");
  }
  return true;
}

function applyFilter(filter) {
  activeFilter = filter;
  video.style.filter = FILTERS[filter];
  document.querySelectorAll(".filter-button").forEach((button) => {
    const selected = button.dataset.filter === filter;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function setCountdown(seconds) {
  countdownSeconds = Number(seconds);
  document.querySelectorAll(".timer-button").forEach((button) => {
    const selected = Number(button.dataset.seconds) === countdownSeconds;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function setStorageStatus(message, state = "") {
  storageStatus.textContent = message;
  storageStatus.dataset.state = state;
}

function openPhotoDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("This browser does not support local photo storage."));
      return;
    }

    const request = window.indexedDB.open(PHOTO_DATABASE, PHOTO_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PHOTO_STORE)) {
        database.createObjectStore(PHOTO_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error("The photo database could not be opened."));
    request.onblocked = () => {
      setStorageStatus("Photo storage is waiting for another SnapSpot tab to close.", "error");
    };
  });
}

function readStoredPhotos(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, "readonly");
    const request = transaction.objectStore(PHOTO_STORE).getAll();
    let records = [];
    request.onsuccess = () => {
      records = request.result;
    };
    request.onerror = () => reject(request.error || new Error("Saved photos could not be read."));
    transaction.oncomplete = () => resolve(records);
    transaction.onerror = () => reject(transaction.error || new Error("Saved photos could not be read."));
    transaction.onabort = () => reject(transaction.error || new Error("Reading saved photos was cancelled."));
  });
}

function writePhotoRecord(database, record) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, "readwrite");
    transaction.objectStore(PHOTO_STORE).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("The photo could not be saved."));
    transaction.onabort = () => reject(transaction.error || new Error("Saving the photo was cancelled."));
  });
}

function deletePhotoRecord(database, id) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, "readwrite");
    transaction.objectStore(PHOTO_STORE).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("The photo could not be deleted."));
    transaction.onabort = () => reject(transaction.error || new Error("Deleting the photo was cancelled."));
  });
}

function createPhotoId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function initializePhotoStorage() {
  let database;
  try {
    database = await openPhotoDatabase();
    const records = await readStoredPhotos(database);
    records
      .filter((record) =>
        record &&
        typeof record.id === "string" &&
        typeof record.imageData === "string" &&
        Object.prototype.hasOwnProperty.call(FILTERS, record.filter) &&
        typeof record.capturedAt === "string" &&
        Number.isFinite(Date.parse(record.capturedAt))
      )
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
      .slice(0, MAX_PHOTOS)
      .reverse()
      .forEach((record) => renderPhoto(record, true));
    setStorageStatus("Photos are saved locally in this browser.", "success");
    return database;
  } catch (error) {
    database?.close();
    photoStorageError = error;
    setStorageStatus(
      `${error.message || "Saved photos could not be loaded."} New photos will stay in the gallery until you leave this page.`,
      "error"
    );
    return null;
  } finally {
    photoStorageReady = true;
    updateCameraControls(Boolean(stream));
  }
}

function showRandomPose() {
  let poseIndex = Math.floor(Math.random() * POSE_IDEAS.length);
  if (POSE_IDEAS.length > 1 && poseIndex === previousPoseIndex) {
    poseIndex = (poseIndex + 1 + Math.floor(Math.random() * (POSE_IDEAS.length - 1))) % POSE_IDEAS.length;
  }
  previousPoseIndex = poseIndex;
  poseIdea.textContent = POSE_IDEAS[poseIndex];
}

function capturePhoto() {
  if (!stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
    setCameraError("The camera preview isn’t ready yet. Wait a moment and try again.");
    isCapturing = false;
    updateCameraControls(Boolean(stream));
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    setCameraError("This browser couldn’t prepare a photo. Try a different browser.");
    isCapturing = false;
    updateCameraControls(Boolean(stream));
    return;
  }

  context.filter = FILTERS[activeFilter];
  if (cameraFacing === "user") {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  context.filter = "none";
  let image;
  try {
    image = canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    isCapturing = false;
    countdownOverlay.hidden = true;
    captureLabel.textContent = "Take a photo";
    updateCameraControls(true);
    setCameraError("The photo couldn’t be saved by this browser. Please try again.");
    return;
  }
  addPhoto(image, activeFilter, new Date());
  flashOverlay.classList.remove("flash");
  void flashOverlay.offsetWidth;
  flashOverlay.classList.add("flash");
  countdownOverlay.hidden = true;
  isCapturing = false;
  captureLabel.textContent = "Take a photo";
  updateCameraControls(true);
}

function addPhoto(source, filter, capturedAt) {
  setCameraError("");
  const record = {
    id: createPhotoId(),
    imageData: source,
    filter,
    capturedAt: capturedAt.toISOString()
  };
  const photo = renderPhoto(record, false);
  photo.savePromise = savePhoto(photo);
}

function renderPhoto(record, isSaved) {
  photoNumber += 1;
  const timestamp = new Date(record.capturedAt);
  const timeLabel = timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const filename = `snapspot-${timestamp.toISOString().replace(/[:.]/g, "-")}.jpg`;
  const card = document.createElement("article");
  card.className = "photo-card";
  card.dataset.photoId = record.id;
  const image = document.createElement("img");
  image.src = record.imageData;
  image.alt = `SnapSpot photo ${photoNumber}, ${record.filter} filter, taken at ${timeLabel}`;
  image.loading = "lazy";
  const label = document.createElement("span");
  label.className = "photo-card-label";
  label.textContent = `${record.filter[0].toUpperCase()}${record.filter.slice(1)} · ${timeLabel}`;
  const saveStatus = document.createElement("span");
  saveStatus.className = "photo-save-status";
  saveStatus.dataset.state = isSaved ? "saved" : "saving";
  saveStatus.textContent = isSaved ? "Saved locally" : "Saving…";
  const download = document.createElement("a");
  download.className = "photo-download";
  download.href = record.imageData;
  download.download = filename;
  download.setAttribute("aria-label", `Download photo ${photoNumber}`);
  download.title = "Download photo";
  download.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3" /></svg>';
  const deleteButton = document.createElement("button");
  deleteButton.className = "photo-delete";
  deleteButton.type = "button";
  deleteButton.setAttribute("aria-label", `Delete photo ${photoNumber}`);
  deleteButton.title = "Delete photo";
  deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg>';
  const photo = { ...record, card, saveStatus, deleteButton, persisted: isSaved, deleted: false, savePromise: null };
  deleteButton.disabled = !isSaved;
  deleteButton.addEventListener("click", () => {
    void removePhoto(photo);
  });
  card.append(image, label, saveStatus, download, deleteButton);
  galleryGrid.prepend(card);
  while (galleryGrid.querySelectorAll(".photo-card").length > MAX_PHOTOS) {
    galleryGrid.querySelector(".photo-card:last-of-type").remove();
  }
  updateGalleryState();
  return photo;
}

async function savePhoto(photo) {
  const database = await photoStorageReadyPromise;
  if (photo.deleted) return;
  if (!database) {
    photo.saveStatus.textContent = "Not saved";
    photo.saveStatus.dataset.state = "error";
    photo.deleteButton.disabled = false;
    setStorageStatus(
      `This photo could not be saved: ${photoStorageError?.message || "local photo storage is unavailable."}`,
      "error"
    );
    return;
  }

  try {
    await writePhotoRecord(database, {
      id: photo.id,
      imageData: photo.imageData,
      filter: photo.filter,
      capturedAt: photo.capturedAt
    });
    photo.persisted = true;
    photo.saveStatus.textContent = "Saved locally";
    photo.saveStatus.dataset.state = "saved";
    photo.deleteButton.disabled = false;
    setStorageStatus("Photo saved on this device.", "success");
  } catch (error) {
    photo.saveStatus.textContent = "Not saved";
    photo.saveStatus.dataset.state = "error";
    photo.deleteButton.disabled = false;
    setStorageStatus(
      `Photo could not be saved: ${error.message || "browser storage may be full or unavailable."}`,
      "error"
    );
  }
}

async function removePhoto(photo) {
  if (photo.deleteButton.disabled) return;
  photo.deleteButton.disabled = true;

  if (photo.persisted) {
    const database = await photoStorageReadyPromise;
    if (!database) {
      photo.deleteButton.disabled = false;
      setStorageStatus("Could not delete the saved photo because local photo storage is unavailable.", "error");
      return;
    }
    try {
      await deletePhotoRecord(database, photo.id);
    } catch (error) {
      photo.deleteButton.disabled = false;
      setStorageStatus(`Photo could not be deleted: ${error.message || "browser storage is unavailable."}`, "error");
      return;
    }
  }

  photo.card.remove();
  updateGalleryState();
  setStorageStatus(photo.persisted ? "Photo deleted from this device." : "Photo removed from the gallery.", "success");
}

function updateGalleryState() {
  const count = galleryGrid.querySelectorAll(".photo-card").length;
  galleryEmpty.hidden = count > 0;
  photoCount.textContent = String(count);
}

function beginCapture() {
  if (!stream || isCapturing) return;
  isCapturing = true;
  setCameraError("");
  captureButton.disabled = true;
  captureLabel.textContent = "Get ready…";

  if (countdownSeconds === 0) {
    capturePhoto();
    return;
  }

  let remaining = countdownSeconds;
  const tick = () => {
    countdownOverlay.textContent = String(remaining);
    countdownOverlay.hidden = false;
    countdownOverlay.classList.remove("tick");
    void countdownOverlay.offsetWidth;
    countdownOverlay.classList.add("tick");
    captureLabel.textContent = remaining === 1 ? "Smile!" : "Get ready…";
    if (remaining === 0) {
      countdownOverlay.textContent = "✦";
      captureTimeout = window.setTimeout(capturePhoto, 250);
      return;
    }
    remaining -= 1;
    captureTimeout = window.setTimeout(tick, 1000);
  };
  tick();
}

async function switchCamera() {
  if (isCapturing || isStartingCamera || !stream) return;
  const previousFacing = cameraFacing;
  const targetFacing = previousFacing === "user" ? "environment" : "user";
  const targetName = targetFacing === "environment" ? "rear" : "front";
  try {
    await refreshCameraDevices();
  } catch (error) {
    cameraDevices = [];
  }

  const previousStream = stream;
  stream = null;
  video.srcObject = null;
  previousStream.getTracks().forEach((track) => track.stop());

  const switched = await startCamera({ facingMode: targetFacing, allowDeviceFallback: true });
  if (switched) {
    setCameraError("");
    return;
  }

  const switchError = cameraError.textContent;
  const restored = await startCamera({ facingMode: previousFacing, allowDeviceFallback: true });
  if (restored) {
    setCameraError(`The ${targetName} camera isn’t available. Your previous camera is still on.`);
  } else {
    setCameraError(`${switchError} The previous camera could not be restarted.`);
  }
}

startButton.addEventListener("click", () => {
  void startCamera();
});

switchButton.addEventListener("click", () => {
  void switchCamera();
});

captureButton.addEventListener("click", beginCapture);
surpriseButton.addEventListener("click", showRandomPose);

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => applyFilter(button.dataset.filter));
});

document.querySelectorAll(".timer-button").forEach((button) => {
  button.addEventListener("click", () => setCountdown(button.dataset.seconds));
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    void refreshCameraDevices()
      .then(() => updateCameraControls(Boolean(stream)))
      .catch(() => setCameraError("We couldn’t refresh the available cameras."));
  });
}

window.addEventListener("pagehide", () => {
  if (captureTimeout !== null) window.clearTimeout(captureTimeout);
  if (stream) stream.getTracks().forEach((track) => track.stop());
});

photoStorageReadyPromise = initializePhotoStorage();
updateCameraControls(false);
