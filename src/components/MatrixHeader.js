'use client';

import { memo } from 'react';

const MatrixHeader = memo(function MatrixHeader({
  checklistItems,
  selectedChecklistItemId,
  onSelectChecklistItem,
  getChecklistItemColor,
  toggleState,
  matrixScrollRef,
}) {
  return (
    <div 
      className="grid gap-2 mb-2"
      style={{ gridTemplateColumns: toggleState ? `80px repeat(${checklistItems.length}, 1fr)` : `50px repeat(${checklistItems.length}, 1fr)` }}
    >
      <div></div>
      {checklistItems.map((item) => {
        const isSelected = selectedChecklistItemId === item.id;
        return (
          <div
            key={item.id}
            onClick={() => {
              if (isSelected) {
                onSelectChecklistItem(null);
              } else {
                onSelectChecklistItem(item.id);
              }
              if (matrixScrollRef.current) {
                matrixScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className={`text-xs font-semibold text-center p-2 rounded border transition-colors cursor-pointer ${
              isSelected
                ? 'text-white border-indigo-600 shadow-md'
                : 'text-slate-700 border-slate-200 bg-slate-50 hover:bg-slate-100'
            }`}
            style={isSelected ? {
              backgroundColor: getChecklistItemColor(item.id).bg,
              borderColor: getChecklistItemColor(item.id).border,
            } : {}}
            title={item.description}
          >
            {item.name}
          </div>
        );
      })}
    </div>
  );
});

export default MatrixHeader;

