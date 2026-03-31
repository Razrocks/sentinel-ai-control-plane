import { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { BlastRadiusItem } from '@/types'

const typeColors: Record<string, string> = {
  service: '#6366f1',
  database: '#ef4444',
  api: '#22c55e',
  queue: '#eab308',
  job: '#f97316',
  monitoring: '#8b5cf6',
  integration: '#06b6d4',
}

const criticalityBorder: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
}

function BlastNode({ data }: NodeProps) {
  const d = data as { label: string; type: string; criticality: string; confidence: string; isRoot?: boolean }
  const borderColor = d.isRoot ? '#6366f1' : (criticalityBorder[d.criticality] || '#2a2a3a')
  const bgColor = d.isRoot ? '#1e1b4b' : '#12121a'

  return (
    <div
      style={{
        background: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        padding: '10px 14px',
        minWidth: 140,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#5a5a70' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: typeColors[d.type] || '#5a5a70',
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e4e4ed' }}>{d.label}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, fontSize: 10 }}>
        <span style={{ color: '#8b8b9e', textTransform: 'capitalize' }}>{d.type}</span>
        <span style={{ color: criticalityBorder[d.criticality] || '#5a5a70', textTransform: 'capitalize' }}>
          {d.criticality}
        </span>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#5a5a70' }} />
    </div>
  )
}

const nodeTypes = { blast: BlastNode }

interface BlastRadiusGraphPanelProps {
  items: BlastRadiusItem[]
  serviceName: string
}

export function BlastRadiusGraphPanel({ items, serviceName }: BlastRadiusGraphPanelProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const rootNode: Node = {
      id: 'root',
      type: 'blast',
      position: { x: 50, y: items.length * 40 },
      data: {
        label: serviceName,
        type: 'service',
        criticality: 'medium',
        confidence: 'high',
        isRoot: true,
      },
    }

    const nodes: Node[] = [rootNode]
    const edges: Edge[] = []

    items.forEach((item, i) => {
      const ySpacing = 90
      const yStart = 0
      nodes.push({
        id: item.id,
        type: 'blast',
        position: { x: 350, y: yStart + i * ySpacing },
        data: {
          label: item.name,
          type: item.type,
          criticality: item.criticality,
          confidence: item.confidence,
        },
      })
      edges.push({
        id: `e-root-${item.id}`,
        source: 'root',
        target: item.id,
        style: { stroke: criticalityBorder[item.criticality] || '#2a2a3a', strokeWidth: 1.5 },
        animated: item.criticality === 'critical',
      })
    })

    return { initialNodes: nodes, initialEdges: edges }
  }, [items, serviceName])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div className="h-[400px] bg-background rounded-lg border border-border overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background color="#1a1a25" gap={20} />
        <Controls
          style={{ background: '#12121a', borderColor: '#2a2a3a', borderRadius: 6 }}
          showInteractive={false}
        />
      </ReactFlow>
    </div>
  )
}
