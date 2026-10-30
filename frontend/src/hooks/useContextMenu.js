import { useState, useCallback } from 'react';

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    x: 0,
    y: 0,
    item: null,
  });

  const openContextMenu = useCallback((e, item, anchorCoords = null) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setContextMenu({
      isOpen: true,
      x: anchorCoords ? anchorCoords.x : e.clientX,
      y: anchorCoords ? anchorCoords.y : e.clientY,
      item,
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false, item: null }));
  }, []);

  return { contextMenu, openContextMenu, closeContextMenu };
}
