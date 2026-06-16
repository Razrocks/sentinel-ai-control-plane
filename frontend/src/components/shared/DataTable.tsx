/**
 * DataTable — generic table wrapper for list pages.
 *
 * Phase 4 rebuild on shadcn primitives:
 *   - Card wrapper with proper border and overflow handling
 *   - Input primitive for search (h-10, larger than before)
 *   - Table primitives (Table/TableHeader/TableRow/TableCell)
 *   - Button primitives for pagination
 *   - Skeleton for loading
 *   - Row padding bumped (py-3 → py-4) for breathable lists
 */
import { useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { EmptyState } from './EmptyState'

interface DataTableProps<T> {
  data: T[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[]
  searchPlaceholder?: string
  pageSize?: number
  /** Headline for the "no rows at all" empty state. */
  emptyTitle?: string
  /** Body copy for the "no rows at all" empty state. */
  emptyDescription?: string
}

export function DataTable<T>({
  data,
  columns,
  searchPlaceholder = 'Search...',
  pageSize = 20,
  emptyTitle,
  emptyDescription,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  })

  const totalRows = table.getFilteredRowModel().rows.length
  const pageIdx = table.getState().pagination.pageIndex
  const pageSizeNow = table.getState().pagination.pageSize

  return (
    <div className="flex flex-col gap-6">
      {/* Search bar */}
      <div className="relative w-full max-w-xl">
        <Search
          className="absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
          style={{ left: '0.875rem' }}
        />
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={searchPlaceholder}
          className="text-sm"
          style={{ height: '2.75rem', paddingLeft: '2.75rem', paddingRight: '1rem' }}
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="px-5">
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          className={cn(
                            'flex items-center gap-1.5',
                            header.column.getCanSort()
                              ? 'cursor-pointer select-none hover:text-foreground transition-colors'
                              : 'cursor-default',
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() &&
                            (header.column.getIsSorted() === 'asc' ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-40" />
                            ))}
                        </button>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="p-0"
                  >
                    {data.length === 0 ? (
                      <EmptyState
                        variant="unfiltered"
                        title={emptyTitle ?? 'Nothing here yet'}
                        description={
                          emptyDescription ??
                          'No records exist yet. Once data flows in, it will surface here.'
                        }
                      />
                    ) : (
                      <EmptyState
                        variant="filtered"
                        title="No matches"
                        description={`Nothing matches "${globalFilter}". Clear the search or try a different term.`}
                        action={
                          <Button variant="outline" size="sm" onClick={() => setGlobalFilter('')}>
                            Clear search
                          </Button>
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="cursor-default">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-5 py-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">
            {pageIdx * pageSizeNow + 1}–{Math.min((pageIdx + 1) * pageSizeNow, totalRows)} of{' '}
            {totalRows}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <span className="px-3 text-foreground tabular-nums">
              Page {pageIdx + 1} of {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
