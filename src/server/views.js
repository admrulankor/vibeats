import ejs from "ejs";
import path from "node:path";
import { directories } from "./config/app-config.js";

export function renderView(viewName, data) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(path.join(directories.views, `${viewName}.ejs`), data, (error, html) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(
        new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8"
          }
        })
      );
    });
  });
}
