"use client";

export function lockBodyScroll(): () => void {
  const { body, documentElement } = document;
  const scrollY = window.scrollY || documentElement.scrollTop || 0;
  const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);

  const prev = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
  };

  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

  return () => {
    body.style.position = prev.position;
    body.style.top = prev.top;
    body.style.left = prev.left;
    body.style.right = prev.right;
    body.style.width = prev.width;
    body.style.overflow = prev.overflow;
    body.style.paddingRight = prev.paddingRight;
    window.scrollTo(0, scrollY);
  };
}

