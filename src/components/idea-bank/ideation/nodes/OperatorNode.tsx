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
          ? 'bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-500 shadow-xl shadow-blue-300/50 ring-2 ring-blue-300'
          : 'bg-gradient-to-br from-slate-50 to-gray-50 border-slate-200 hover:border-blue-400 hover:shadow-lg'
        }
      `}
    >
      {/* Left handle - connects from parent */}
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-3 !h-3 !border-2 !border-white transition-all ${
          isSelected ? '!bg-blue-600 !scale-125' : '!bg-slate-400'
        }`}
      />
      {/* Right handle - for potential extensions */}
      <Handle
        type="source"
        position={Position.Right}
        className={`!w-3 !h-3 !border-2 !border-white transition-all ${
          isSelected ? '!bg-blue-600 !scale-125' : '!bg-slate-400'
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
              ? 'bg-blue-500 text-white shadow-md' 
              : 'bg-slate-100 text-slate-400 hover:bg-blue-100 hover:text-blue-600'
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
            isSelected ? 'text-blue-700' : 'text-slate-800'
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
              <span className="text-[10px] text-blue-600 font-medium">
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

