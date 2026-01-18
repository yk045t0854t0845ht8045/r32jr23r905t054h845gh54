// components/button.tsx
import { ReactNode } from "react";

interface ButtonProps {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  className?: string;
}

export function Button({
  children,
  href,
  onClick,
  iconLeft,
  iconRight,
  className = "",
}: ButtonProps) {
  const baseClasses =
    "group inline-flex items-center gap-2 rounded-md border border-white/10 " +
    "bg-[#1a1a1a] px-3 py-1.5 font-medium text-gray-100 shadow-sm " +
    "transition-all duration-300 ease-out " +
    "hover:bg-[#222] hover:border-white/20 hover:shadow-md";

  const content = (
    <>
      {iconLeft && (
        <span className="flex items-center text-gray-400 transition-transform duration-300 ease-out group-hover:-translate-x-0.5">
          {iconLeft}
        </span>
      )}

      <span className="whitespace-nowrap">{children}</span>

      {iconRight && (
        <span className="flex items-center text-gray-400 transition-transform duration-300 ease-out group-hover:translate-x-0.5">
          {iconRight}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <a href={href} className={`${baseClasses} ${className}`}>
        {content}
      </a>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`${baseClasses} ${className}`}
    >
      {content}
    </button>
  );
}
