import { useState, useEffect, useCallback } from 'react';

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    x: 0,
    y: 0,
    item: null,
  });

  const openContextMenu = useCallback((e, item) => {
    e.preventDefault();
    e.stopPropagation();

    // Default popover dimensions estimate (approx 180px width, 220px height)
    const menuWidth = 180;
    const menuHeight = 220;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }

    setContextMenu({
      isOpen: true,
      x,
      y,
      item,
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, isOpen: false }));
  }, []);

  useEffect(() => {
    if (!contextMenu.isOpen) return;

    const handleOutsideClick = () => closeContextMenu();
    const handleScroll = () => closeContextMenu();
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu.isOpen, closeContextMenu]);

  return { contextMenu, openContextMenu, closeContextMenu };
}
