"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Uma ação do menu. `separatorBefore` injeta um <hr> acima do item. */
export interface MenuAction {
  key: string;
  icon: string;
  label: string;
  onSelect: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
  separatorBefore?: boolean;
}

interface Props {
  actions: MenuAction[];
  /** Rótulo acessível do gatilho (ex.: "Ações: <título da vaga>"). */
  label: string;
  /** Desabilita o menu inteiro enquanto uma ação está em andamento. */
  disabled?: boolean;
}

/**
 * Menu de ações por card. Gatilho ⋯ + dropdown role="menu". Fecha ao clicar
 * fora, no Escape, no Tab ou ao escolher um item. Navegação por setas com wrap,
 * pulando itens desabilitados. Sem dependências externas.
 */
export function HamburgerMenu({ actions, label, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Ref para o nó portado — necessário para o click-outside não fechar ao
  // clicar dentro do dropdown (que agora vive em <body>, fora de rootRef).
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora do menu (evita overlays zumbis).
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      const inRoot = rootRef.current?.contains(e.target as Node);
      const inPortal = dropdownRef.current?.contains(e.target as Node);
      if (!inRoot && !inPortal) setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    return () => document.removeEventListener("mousedown", onDocPointer);
  }, [open]);

  // Ao abrir, foca o primeiro item habilitado. `preventScroll` impede o browser
  // de rolar a página para trazer o item portado (em <body>) à vista — era a
  // origem do "pulo" de scroll ao abrir o menu.
  useEffect(() => {
    if (!open) return;
    itemRefs.current.find((el) => el && !el.disabled)?.focus({ preventScroll: true });
  }, [open]);

  function close(restoreFocus = true): void {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  // Move o foco entre itens habilitados, com wrap nas extremidades.
  function moveFocus(dir: 1 | -1, fromIndex: number): void {
    const els = itemRefs.current;
    const n = els.length;
    if (n === 0) return;
    let i = fromIndex;
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n;
      const el = els[i];
      if (el && !el.disabled) {
        el.focus();
        return;
      }
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const idx = itemRefs.current.findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveFocus(1, idx < 0 ? -1 : idx);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-1, idx < 0 ? 0 : idx);
        break;
      case "Home":
        e.preventDefault();
        moveFocus(1, -1);
        break;
      case "End":
        e.preventDefault();
        moveFocus(-1, 0);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  // Posição do dropdown: calculada a partir do gatilho para funcionar no portal.
  const [dropPos, setDropPos] = useState({ top: 0, right: 0 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    function recalc() {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      setDropPos({
        top: r.bottom + window.scrollY + 4,
        right: window.innerWidth - r.right,
      });
    }

    recalc();
    window.addEventListener("scroll", recalc, { passive: true, capture: true });
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, { capture: true });
      window.removeEventListener("resize", recalc);
    };
  }, [open]);

  const dropdown = open ? (
    <div
      ref={dropdownRef}
      className="hamburger-dropdown"
      role="menu"
      aria-label={label}
      onKeyDown={onMenuKeyDown}
      style={{
        position: "absolute",
        top: dropPos.top,
        right: dropPos.right,
        zIndex: 9990,
      }}
    >
      {actions.map((a, idx) => (
        <Fragment key={a.key}>
          {a.separatorBefore && <hr className="hamburger-sep" role="separator" aria-hidden="true" />}
          <button
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            type="button"
            role="menuitem"
            className={`hamburger-item${a.variant === "danger" ? " hamburger-item-danger" : ""}`}
            disabled={a.disabled}
            onClick={() => {
              setOpen(false);
              a.onSelect();
            }}
          >
            <span className="hamburger-item-icon" aria-hidden="true">{a.icon}</span>
            {a.label}
          </button>
        </Fragment>
      ))}
    </div>
  ) : null;

  return (
    <div className="hamburger-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="hamburger-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={(e) => {
          // Isola o gatilho: barra o default e o bubbling para qualquer
          // handler/efeito de scroll do card pai.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        ⋯
      </button>

      {/* Portal: renderiza o dropdown diretamente no <body>, escapando de
          qualquer stacking context do card (content-visibility, transform…). */}
      {typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </div>
  );
}
