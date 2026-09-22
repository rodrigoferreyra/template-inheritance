/**
 * Vite middleware: POST /api/render-catalog + static GET /output/*
 */

import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import { getProducts } from "./src/resolve";
import {
  REPO_ROOT,
  runCatalogRender,
  type CatalogRenderManifest,
} from "./scripts/lib/render-catalog-core";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg"))
    return "image/jpeg";
  if (filePath.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export function catalogApiPlugin(): Plugin {
  return {
    name: "catalog-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";

        // Serve rendered catalog files: /output/catalog/...
        if (req.method === "GET" && url.startsWith("/output/")) {
          const rel = url.replace(/^\/+/, "");
          const abs = path.resolve(REPO_ROOT, rel);
          const outputRoot = path.resolve(REPO_ROOT, "output");
          if (!abs.startsWith(outputRoot + path.sep) && abs !== outputRoot) {
            sendJson(res, 403, { error: "Forbidden" });
            return;
          }
          if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
            sendJson(res, 404, { error: "Not found" });
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", contentTypeFor(abs));
          res.setHeader("Cache-Control", "no-store");
          fs.createReadStream(abs).pipe(res);
          return;
        }

        if (req.method === "POST" && url === "/api/render-catalog") {
          try {
            const body = (await readJsonBody(req)) as {
              customerId?: string;
              limit?: number;
              areas?: "first" | "all";
              colorId?: string;
              allowEvaluationMode?: boolean;
            };

            if (!body.customerId || typeof body.customerId !== "string") {
              sendJson(res, 400, { error: "customerId is required" });
              return;
            }

            const manifest: CatalogRenderManifest = await runCatalogRender({
              customer: body.customerId,
              limit: body.limit,
              areas: body.areas ?? "all",
              colorId: body.colorId,
              allowEvaluationMode: body.allowEvaluationMode === true,
              onProgress: (message) => {
                server.config.logger.info(`[catalog] ${message}`);
              },
            });

            const productsById = Object.fromEntries(
              getProducts().map((p) => [p.id, p]),
            );

            const images: Array<{
              productId: string;
              productName: string;
              areaId: string;
              areaLabel: string;
              colorId: string;
              kind: "print" | "mockup";
              url: string;
            }> = [];

            for (const entry of manifest.results) {
              if (entry.error) continue;
              const product = productsById[entry.productId];
              const area = product?.areas.find((a) => a.id === entry.areaId);
              const productName = product?.name ?? entry.productId;
              const areaLabel = area?.label ?? entry.areaId;
              const base = {
                productId: entry.productId,
                productName,
                areaId: entry.areaId,
                areaLabel,
                colorId: entry.colorId,
              };
              if (entry.mockup) {
                images.push({
                  ...base,
                  kind: "mockup",
                  url: `/${entry.mockup.replace(/\\/g, "/")}?t=${manifest.elapsedMs}`,
                });
              }
              if (entry.print) {
                images.push({
                  ...base,
                  kind: "print",
                  url: `/${entry.print.replace(/\\/g, "/")}?t=${manifest.elapsedMs}`,
                });
              }
            }

            sendJson(res, 200, {
              customerId: body.customerId,
              manifest,
              images,
              warning: manifest.warning,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            server.config.logger.error(`[catalog] ${message}`);
            sendJson(res, 500, { error: message });
          }
          return;
        }

        next();
      });
    },
  };
}
