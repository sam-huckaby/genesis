import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  headerMeta?: ReactNode;
  footer?: ReactNode;
  footerAlign?: "left" | "center" | "right";
  children: ReactNode;
};

export default function Card({
  title,
  headerMeta,
  footer,
  footerAlign = "right",
  children
}: CardProps) {
  return (
    <div className="card">
      {title ? (
        <div className="card-header">
          <h2 className="card-title">{title}</h2>
          {headerMeta ? <div className="card-header-meta">{headerMeta}</div> : null}
        </div>
      ) : null}
      <div className="card-body">{children}</div>
      {footer ? (
        <div className={`card-footer card-footer-${footerAlign}`}>{footer}</div>
      ) : null}
    </div>
  );
}
