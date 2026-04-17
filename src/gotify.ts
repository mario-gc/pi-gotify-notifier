/**
 * Gotify HTTP client — sends notifications to a Gotify server.
 */

import * as https from "node:https";
import type { GotifyConfig } from "./config.js";

export async function sendToGotify(
  config: GotifyConfig,
  title: string,
  message: string,
  priority = 5,
): Promise<boolean> {
  const url = `${config.url}/message`;
  const body = JSON.stringify({ title, message, priority });

  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gotify-Key": config.token,
          "Content-Length": Buffer.byteLength(body),
        },
        agent: config.agent,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else {
          resolve(false);
        }
        res.resume();
      },
    );

    req.on("error", () => resolve(false));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}
