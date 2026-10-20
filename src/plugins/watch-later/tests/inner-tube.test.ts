import { expect, test } from "@playwright/test";

import {
  answeredSignedOut,
  parseMutationResponse,
} from "../backend/inner-tube";
import { appliedEditAnswer, refusedEditAnswer } from "./fixture-answers";

test("a refused write is a failure, whatever its 200 said", () => {
  const result = parseMutationResponse(200, refusedEditAnswer());

  expect(result.ok).toBe(false);
  expect(result.error).toBe("STATUS_FAILED");
});

test("an applied write is a success", () => {
  expect(parseMutationResponse(200, appliedEditAnswer())).toEqual({ ok: true });
});

// An `error` object is a refusal however its code is written: the check this replaced only
// recognised a string there, so a numeric one read as success.
test("an error object is a refusal even when its code is a number", () => {
  expect(
    parseMutationResponse(200, {
      error: { code: 429, message: "Too Many Requests" },
    })
  ).toEqual({ error: "429: Too Many Requests", ok: false });
});

test("a status code outside 2xx is a refusal", () => {
  expect(parseMutationResponse(500, {})).toEqual({
    error: "request failed with 500",
    ok: false,
  });
});

test("the signed-out flag is read out of the answer's own tracking", () => {
  expect(answeredSignedOut(refusedEditAnswer())).toBe(true);
  expect(answeredSignedOut(appliedEditAnswer())).toBe(false);
  // No flag to read: an answer is taken at face value.
  expect(answeredSignedOut({ alerts: [] })).toBe(false);
});
