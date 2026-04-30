const post = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

export async function uploadImage(file) {
  const form = new FormData();
  form.append("file", file);
  return fetch("/api/upload", { method: "POST", body: form }).then((r) => r.json());
}

export async function uploadBatch(files) {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const data = await fetch("/api/upload-batch", { method: "POST", body: form }).then((r) => r.json());
  // Normalize snake_case from backend → camelCase for frontend
  return {
    images: (data.images ?? []).map(({ image_id, url }) => ({ imageId: image_id, url })),
  };
}

export const getRecommendations = (imageId, sessionId, condition) =>
  post("/api/recommend", { image_id: imageId, session_id: sessionId, condition });

export const applyParams = (imageId, params, sessionId) =>
  post("/api/apply", { image_id: imageId, params, session_id: sessionId });

export const sendFeedback = (imageId, params, direction, sessionId) =>
  post("/api/feedback", { image_id: imageId, params, direction, session_id: sessionId });

export const batchApply = (imageIds, params, sessionId) =>
  post("/api/batch", { image_ids: imageIds, params, session_id: sessionId });
