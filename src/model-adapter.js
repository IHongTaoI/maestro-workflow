import { ValidationError } from "./errors.js";
import { isPlainObject, requireNonEmptyString } from "./util.js";

function textFromResponse(response) {
  if (typeof response === "string") {
    return response;
  }
  if (!response || typeof response !== "object") {
    return null;
  }
  if (typeof response.text === "string") {
    return response.text;
  }
  if (typeof response.content === "string") {
    return response.content;
  }
  if (Array.isArray(response.content)) {
    const text = response.content
      .map((item) => (item && typeof item.text === "string" ? item.text : ""))
      .join("");
    if (text) {
      return text;
    }
  }
  return response.choices?.[0]?.message?.content ?? response.output_text ?? null;
}

export function extractModelJson(response) {
  if (isPlainObject(response) && response.status === "completed") {
    return response;
  }
  const text = textFromResponse(response);
  if (typeof text !== "string") {
    throw new ValidationError("Model response does not contain a JSON object.");
  }
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    const parsed = JSON.parse(fenced ? fenced[1] : trimmed);
    if (!isPlainObject(parsed)) {
      throw new Error("JSON value is not an object");
    }
    return parsed;
  } catch (error) {
    throw new ValidationError(`Model response is not valid JSON: ${error.message}`);
  }
}

export function createModelRunner({ model, invoke, tier = "memory" }) {
  requireNonEmptyString(model, "model");
  if (typeof invoke !== "function") {
    throw new ValidationError("invoke must be a function.");
  }
  return async (request) => extractModelJson(await invoke({ model, tier, request }));
}
