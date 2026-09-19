import React, { useCallback, useEffect, useRef, useState } from 'react';

// 方形裁剪：拖动方框选择区域，滑块调整方框大小
export default function CropModal({ imageSrc, onDone, onClose }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [box, setBox] = useState(null); // {x, y, size} 显示坐标
  const [imgRect, setImgRect] = useState(null);

  const clamp = useCallback((b, rect) => {
    const size = Math.max(30, Math.min(b.size, Math.min(rect.w, rect.h)));
    return {
      size,
      x: Math.max(0, Math.min(b.x, rect.w - size)),
      y: Math.max(0, Math.min(b.y, rect.h - size)),
    };
  }, []);

  const initBox = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const rect = { w: img.clientWidth, h: img.clientHeight };
    setImgRect(rect);
    const size = Math.min(rect.w, rect.h) * 0.6;
    setBox({ x: (rect.w - size) / 2, y: (rect.h - size) / 2, size });
  }, []);

  useEffect(() => {
    window.addEventListener('resize', initBox);
    return () => window.removeEventListener('resize', initBox);
  }, [initBox]);

  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, box };
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag || !imgRect) return;
    const container = containerRef.current.getBoundingClientRect();
    const img = imgRef.current.getBoundingClientRect();
    // 显示坐标与容器坐标比例一致（直接使用位移像素）
    const scaleX = imgRect.w / img.width || 1;
    const dx = (e.clientX - drag.startX) * scaleX;
    const dy = (e.clientY - drag.startY) * scaleX;
    setBox(clamp({ ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy }, imgRect));
    void container;
  };

  const onPointerUp = () => { dragRef.current = null; };

  const onResize = (e) => {
    if (!imgRect) return;
    setBox(clamp({ ...box, size: Number(e.target.value) }, imgRect));
  };

  const confirm = () => {
    const img = imgRef.current;
    if (!img || !box || !imgRect) return;
    const scale = img.naturalWidth / imgRect.w;
    const canvas = document.createElement('canvas');
    const out = 256;
    canvas.width = out;
    canvas.height = out;
    canvas.getContext('2d').drawImage(
      img,
      box.x * scale, box.y * scale, box.size * scale, box.size * scale,
      0, 0, out, out,
    );
    onDone(canvas.toDataURL('image/jpeg', 0.9));
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <h3>框选方形头像区域</h3>
        <div className="crop-container" ref={containerRef}>
          <img
            ref={imgRef}
            src={imageSrc}
            alt="裁剪原图"
            className="crop-image"
            onLoad={initBox}
            draggable={false}
          />
          {box && imgRect && (
            <>
              <div className="crop-shade" style={{
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box.x}px ${box.y}px, ${box.x}px ${box.y + box.size}px, ${box.x + box.size}px ${box.y + box.size}px, ${box.x + box.size}px ${box.y}px, ${box.x}px ${box.y}px)`,
              }} />
              <div
                className="crop-box"
                style={{ left: box.x, top: box.y, width: box.size, height: box.size }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </>
          )}
        </div>
        {box && imgRect && (
          <label className="crop-slider">
            方框大小
            <input
              type="range"
              min={30}
              max={Math.floor(Math.min(imgRect.w, imgRect.h))}
              value={Math.round(box.size)}
              onChange={onResize}
            />
          </label>
        )}
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={confirm} disabled={!box}>确定</button>
          <button className="btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
