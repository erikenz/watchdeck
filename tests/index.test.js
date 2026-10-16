import path from "node:path";
import process from "node:process";

import { test, expect, _electron as electron } from "@playwright/test";

process.env.NODE_ENV = "test";

const appPath = path.resolve(import.meta.dirname, "..");

test("Watchdeck App - With default settings, app is launched and visible", async () => {
  const app = await electron.launch({
    args: [
      appPath,
      "--no-sandbox",
      "--disable-gpu",
      "--whitelisted-ips=",
      "--disable-dev-shm-usage",
    ],
    cwd: appPath,
  });

  const window = await app.firstWindow();

  const consentForm = await window.$(
    "form[action='https://consent.\u0079\u006F\u0075\u0074\u0075\u0062\u0065.com/save']"
  );
  if (consentForm) {
    await consentForm.click("button");
  }

  // const title = await window.title();
  // expect(title.replaceAll(/\s/g, ' ')).toEqual('Watchdeck');

  const url = window.url();
  expect(
    url.startsWith("https://www.\u0079\u006F\u0075\u0074\u0075\u0062\u0065.com")
  ).toBe(true);

  await app.close();
});
