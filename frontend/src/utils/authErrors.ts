import { ApiError } from "./api";

export interface ExplainedAuthError {
  title: string;
  message: string;
  tips: string[];
}

function normalizeMessage(input: unknown): string {
  if (typeof input === "string" && input.trim().length > 0) {
    return input.trim();
  }
  return "Authentication failed. Please try again.";
}

function tipsForMessage(message: string): string[] {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("invalid") &&
    (normalized.includes("credential") || normalized.includes("email") || normalized.includes("password"))
  ) {
    return [
      "Check that your email address is correct.",
      "Ensure Caps Lock is not affecting your password.",
      "If needed, create a new account from the register page.",
    ];
  }
  if (normalized.includes("already") && normalized.includes("exist")) {
    return [
      "Try signing in with this email instead of registering again.",
      "Use a different email if you need a separate workspace.",
    ];
  }
  if (normalized.includes("password")) {
    return [
      "Use at least 8 characters.",
      "Include a mix of letters, numbers, and symbols for stronger security.",
    ];
  }
  return [
    "Retry in a few seconds in case of a temporary network issue.",
    "If this continues, verify API availability and try again.",
  ];
}

export function explainAuthError(error: unknown): ExplainedAuthError {
  if (error instanceof ApiError) {
    return {
      title: "Unable to continue",
      message: normalizeMessage(error.message),
      tips: tipsForMessage(error.message),
    };
  }

  if (error instanceof Error) {
    return {
      title: "Request failed",
      message: normalizeMessage(error.message),
      tips: tipsForMessage(error.message),
    };
  }

  return {
    title: "Authentication error",
    message: "Something went wrong while processing your request.",
    tips: ["Please try again."],
  };
}
