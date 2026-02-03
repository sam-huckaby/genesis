import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  children: ReactNode;
};

export default function Card({ title, children }: CardProps) {
  return (
    <div className="card">
      {title ? <h2 className="card-title">{title}</h2> : null}
      <div className="card-body">{children}</div>
    </div>
  );
}
