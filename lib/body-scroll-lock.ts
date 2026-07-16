type BodyOverflowStyle = Pick<CSSStyleDeclaration, "overflow">;

type BodyScrollLockManager = {
  acquire: () => () => void;
};

export function createBodyScrollLockManager(
  resolveStyle: () => BodyOverflowStyle | null = () => (
    typeof document === "undefined" ? null : document.body.style
  ),
): BodyScrollLockManager {
  let activeLocks = 0;
  let overflowBeforeFirstLock = "";

  return {
    acquire() {
      const style = resolveStyle();
      if (!style) return () => undefined;

      if (activeLocks === 0) {
        overflowBeforeFirstLock = style.overflow;
        style.overflow = "hidden";
      }
      activeLocks += 1;

      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeLocks = Math.max(0, activeLocks - 1);

        if (activeLocks === 0) {
          const currentStyle = resolveStyle();
          if (currentStyle) currentStyle.overflow = overflowBeforeFirstLock;
        }
      };
    },
  };
}

const bodyScrollLockManager = createBodyScrollLockManager();

export function lockBodyScroll() {
  return bodyScrollLockManager.acquire();
}
