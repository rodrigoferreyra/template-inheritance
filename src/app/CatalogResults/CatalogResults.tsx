/**
 * Grid of catalog render outputs (print + mockup PNGs from /output/catalog).
 * Labels are always resolved catalog values — never template placeholders.
 */

import { useEffect, useId, useState } from "react";

import styles from "./CatalogResults.module.css";

export interface CatalogImage {
  productId: string;
  productName: string;
  areaId: string;
  areaLabel: string;
  colorId: string;
  kind: "print" | "mockup";
  url: string;
}

export interface CatalogRenderStats {
  productCount: number;
  areaCount: number;
  imageCount: number;
  ok: number;
  failed: number;
  elapsedMs: number;
  evaluationMode?: boolean;
}

interface CatalogResultsProps {
  customerName: string;
  images: CatalogImage[];
  stats: CatalogRenderStats;
}

function ViewIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function CatalogResults({
  customerName,
  images,
  stats,
}: CatalogResultsProps) {
  const [viewing, setViewing] = useState<CatalogImage | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!viewing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewing(null);
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [viewing]);

  if (images.length === 0) {
    return null;
  }

  const { productCount, areaCount, imageCount, failed, elapsedMs } = stats;

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h3 className={styles.title}>{customerName}</h3>
        <p className={styles.meta}>
          {productCount} products · {areaCount} areas · {imageCount} images
          {failed > 0 ? ` · ${failed} failed` : ""}
          {` · ${(elapsedMs / 1000).toFixed(1)}s`}
        </p>
      </header>
      <div className={styles.grid}>
        {images.map((image) => (
          <figure
            key={`${image.productId}-${image.areaId}-${image.kind}-${image.url}`}
            className={styles.card}
          >
            <div className={styles.media}>
              <img
                src={image.url}
                alt={`${image.productName} ${image.areaLabel} ${image.kind}`}
                className={styles.image}
                loading="lazy"
              />
              <div className={styles.overlay}>
                <button
                  type="button"
                  className={styles.viewButton}
                  title="View"
                  aria-label={`View ${image.productName} ${image.areaLabel} ${image.kind}`}
                  onClick={() => setViewing(image)}
                >
                  <ViewIcon />
                  <span>View</span>
                </button>
              </div>
            </div>
            <figcaption className={styles.caption}>
              <span className={styles.productName}>{image.productName}</span>
              <span className={styles.detail}>
                {image.areaLabel} · {image.kind} · {image.colorId}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      {viewing && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={() => setViewing(null)}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h4 id={titleId} className={styles.modalTitle}>
                {viewing.productName} · {viewing.areaLabel} · {viewing.kind}
              </h4>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                onClick={() => setViewing(null)}
              >
                Close
              </button>
            </div>
            <img
              src={viewing.url}
              alt={`${viewing.productName} ${viewing.areaLabel} ${viewing.kind}`}
              className={styles.modalImage}
            />
          </div>
        </div>
      )}
    </section>
  );
}
