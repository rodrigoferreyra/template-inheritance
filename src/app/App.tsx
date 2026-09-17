/**
 * Catalog inheritance UI shell.
 * Render catalog runs the same headless resolve + batch path as
 * `npm run render:catalog` via POST /api/render-catalog (Node CE.SDK).
 */

import { useState } from "react";

import type { CustomerOverride } from "./customer-catalog";
import CustomerSelector from "./CustomerSelector/CustomerSelector";
import CatalogResults, {
  type CatalogImage,
  type CatalogRenderStats,
} from "./CatalogResults/CatalogResults";

import styles from "./App.module.css";

interface RenderCatalogResponse {
  customerId: string;
  images: CatalogImage[];
  manifest: CatalogRenderStats & {
    customer?: string;
    warning?: string;
  };
  warning?: string;
  error?: string;
}

export default function App() {
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerOverride | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<CatalogImage[]>([]);
  const [stats, setStats] = useState<CatalogRenderStats | null>(null);
  const [renderedCustomerName, setRenderedCustomerName] = useState<
    string | null
  >(null);

  const handleRender = async () => {
    if (!selectedCustomer || rendering) return;

    setRendering(true);
    setError(null);
    setImages([]);
    setStats(null);
    setRenderedCustomerName(null);

    try {
      const params = new URLSearchParams(window.location.search);
      const limitParam = params.get("limit");
      const limit =
        limitParam != null && Number.isFinite(Number(limitParam))
          ? Number(limitParam)
          : undefined;
      const allowEvaluationMode =
        params.get("allowEvaluationMode") === "1" ||
        params.get("allowEvaluationMode") === "true";

      const response = await fetch("/api/render-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          ...(limit != null && limit > 0 ? { limit } : {}),
          ...(allowEvaluationMode ? { allowEvaluationMode: true } : {}),
        }),
      });

      const data = (await response.json()) as RenderCatalogResponse;
      if (!response.ok) {
        throw new Error(data.error || `Render failed (${response.status})`);
      }

      const nextStats: CatalogRenderStats = {
        productCount: data.manifest.productCount,
        areaCount: data.manifest.areaCount,
        imageCount: data.manifest.imageCount,
        ok: data.manifest.ok,
        failed: data.manifest.failed,
        elapsedMs: data.manifest.elapsedMs,
        evaluationMode: data.manifest.evaluationMode,
      };

      // Guard: only show tiles under this customer's output path
      const prefix = `/output/catalog/${selectedCustomer.id}/`;
      const scoped = (data.images ?? []).filter((img) =>
        img.url.startsWith(prefix),
      );

      setImages(scoped);
      setStats(nextStats);
      setRenderedCustomerName(selectedCustomer.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className={styles.app}>
      <CustomerSelector
        selectedCustomer={selectedCustomer}
        disabled={rendering}
        onSelect={setSelectedCustomer}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.renderButton}
          disabled={!selectedCustomer || rendering}
          onClick={handleRender}
        >
          {rendering ? "Rendering catalog…" : "Render catalog"}
        </button>
        {selectedCustomer && !rendering && (
          <p className={styles.hint}>{selectedCustomer.name}</p>
        )}
        {rendering && (
          <p className={styles.hint}>
            Resolving scenes and exporting print + mockup for{" "}
            {selectedCustomer?.name}…
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        {stats?.evaluationMode && (
          <p className={styles.error}>
            CE.SDK ran in evaluation mode (IMG.LY watermark). Set a valid{" "}
            <code>CESDK_LICENSE</code> or <code>VITE_CESDK_LICENSE</code> in{" "}
            <code>.env</code> and restart the dev server. Evaluation mode is
            only used when the API is called with{" "}
            <code>allowEvaluationMode: true</code>.
          </p>
        )}
      </div>

      {stats && renderedCustomerName && (
        <CatalogResults
          customerName={renderedCustomerName}
          images={images}
          stats={stats}
        />
      )}
    </div>
  );
}
