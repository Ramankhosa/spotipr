'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Square, CheckSquare } from 'lucide-react'

interface OperatorNodeData {
  title: string
  description?: string
  tags?: string[]
  selected?: boolean
  onSelect?: () => void
}

function OperatorNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as OperatorNodeData
  const isSelected = nodeData.selected || selected
  
  return (
    <div
      className={`
        px-3 py-2.5 rounded-xl shadow-md border w-[340px]
        transition-all duration-200 cursor-pointer
        ${isSelected
          ? 'bg-gradient-to-br from-lamp-50 to-lamp-50 border-lamp-500 shadow-xl shadow-lamp-300/50 ring-2 ring-lamp-300'
          : 'bg-gradient-to-br from-slate-50 to-gray-50 border-slate-200 hover:border-lamp-400 hover:shadow-lg'
        }
      `}
    >
      {/* Left handle - connects from parent */}
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-3 !h-3 !border-2 !border-white transition-all ${
          isSelected ? '!bg-lamp-600 !scale-125' : '!bg-slate-400'
        }`}
      />
      {/* Right handle - for potential extensions */}
      <Handle
        type="source"
        position={Position.Right}
        className={`!w-3 !h-3 !border-2 !border-white transition-all ${
          isSelected ? '!bg-lamp-600 !scale-125' : '!bg-slate-400'
        }`}
      />
      
      <div className="flex items-start gap-2">
        {/* Checkbox for selection */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            nodeData.onSelect?.()
          }}
          className={`
            flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center
            transition-all duration-200 hover:scale-110
            ${isSelected 
              ? 'bg-lamp-500 text-white shadow-md' 
              : 'bg-slate-100 text-slate-400 hover:bg-lamp-100 hover:text-lamp-600'
            }
          `}
          title={isSelected ? 'Click to deselect' : 'Click to select for idea generation'}
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>
        
        <div className="flex-1">
          {/* Title - full text visible, no truncation */}
          <h4 className={`font-semibold text-sm leading-snug ${
            isSelected ? 'text-lamp-700' : 'text-slate-800'
          }`}>
            {nodeData.title}
          </h4>
          {nodeData.description && (
            <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
              {nodeData.description}
            </p>
          )}
          {isSelected && (
            <div className="mt-2 pt-2 border-t border-slate-100">
              <span className="text-[10px] text-lamp-600 font-medium">
                ✓ Selected for idea generation
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(OperatorNode)

