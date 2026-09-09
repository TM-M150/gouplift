"use client";

import * as React from "react";
import Link from "next/link";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconLoader,
  IconPlus,
} from "@tabler/icons-react";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type SortingState,
} from "@tanstack/react-table";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
});

export const schema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  goalAmount: z.number(),
  amountRaised: z.number(),
  donorCount: z.number(),
  currency: z.string(),
});

type Fundraiser = z.infer<typeof schema>;

const columnHelper = createColumnHelper<typeof features, Fundraiser>();

function formatKES(amount: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; className: string; icon?: React.ReactNode }
  > = {
    ACTIVE: {
      label: "Active",
      className:
        "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
      icon: <IconCircleCheckFilled className="size-3.5 fill-green-500" />,
    },
    DRAFT: {
      label: "Draft",
      className: "border-muted-foreground/30 text-muted-foreground",
    },
    COMPLETED: {
      label: "Completed",
      className:
        "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
      icon: <IconCircleCheckFilled className="size-3.5 fill-blue-500" />,
    },
    PAUSED: {
      label: "Paused",
      className:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
      icon: <IconLoader className="size-3.5" />,
    },
    PENDING_REVIEW: {
      label: "Pending Review",
      className: "border-orange-200 bg-orange-50 text-orange-700",
    },
    CANCELLED: {
      label: "Cancelled",
      className: "border-red-200 bg-red-50 text-red-700",
    },
    REJECTED: {
      label: "Rejected",
      className: "border-red-200 bg-red-50 text-red-700",
    },
    EXPIRED: {
      label: "Expired",
      className: "border-muted-foreground/30 text-muted-foreground",
    },
  };

  const item = config[status] ?? {
    label: status,
    className: "text-muted-foreground",
  };

  return (
    <Badge variant="outline" className={`gap-1 px-1.5 ${item.className}`}>
      {item.icon}
      {item.label}
    </Badge>
  );
}

function formatType(type: string) {
  return type
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const columns = columnHelper.columns([
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={
            table.getIsSomePageRowsSelected() &&
            !table.getIsAllPageRowsSelected()
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }),
  columnHelper.accessor("title", {
    header: "Fundraiser",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="max-w-[280px] line-clamp-1 font-medium">
          {row.original.title}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatType(row.original.type)}
        </span>
      </div>
    ),
    enableHiding: false,
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  }),
  columnHelper.accessor("goalAmount", {
    header: () => <div className="text-right">Goal</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatKES(row.original.goalAmount)}
      </div>
    ),
  }),
  columnHelper.accessor("amountRaised", {
    header: () => <div className="text-right">Raised</div>,
    cell: ({ row }) => {
      const progress =
        row.original.goalAmount > 0
          ? Math.min(
              100,
              Math.round(
                (row.original.amountRaised / row.original.goalAmount) * 100,
              ),
            )
          : 0;

      return (
        <div className="flex flex-col items-end gap-1">
          <span className="font-medium tabular-nums">
            {formatKES(row.original.amountRaised)}
          </span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="w-8 text-xs tabular-nums text-muted-foreground">
              {progress}%
            </span>
          </div>
        </div>
      );
    },
  }),
  columnHelper.accessor("donorCount", {
    header: () => <div className="text-right">Donors</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {row.original.donorCount.toLocaleString()}
      </div>
    ),
  }),
  columnHelper.display({
    id: "actions",
    cell: () => (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-8 data-[state=open]:bg-muted"
            />
          }
        >
          <IconDotsVertical className="size-4" />
          <span className="sr-only">Open menu</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem>View</DropdownMenuItem>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Share</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive">
            Pause
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }),
]);

interface DataTableProps {
  organizationId: string;
}

export function DataTable({ organizationId }: DataTableProps) {
  const fundraisers = useQuery(
    api.organizations.listFundraisersByOrganization,
    {
      organizationId: organizationId as Id<"organizations">,
    },
  );

  const data: Fundraiser[] = fundraisers ?? [];
  const isLoading = fundraisers === undefined;

  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  });

  const table = useTable({
    data,
    columns,
    features,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    getRowId: (row) => row.id,
  });

  const pageSize = table.state.pagination?.pageSize ?? 10;
  const pageIndex = table.state.pagination?.pageIndex ?? 0;
  const pageCount = Math.max(table.getPageCount(), 1);

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-2">
          <Input
            placeholder="Search fundraisers..."
            value={(table.getColumn("title")?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              table.getColumn("title")?.setFilterValue(event.target.value)
            }
            className="h-8 w-[200px] lg:w-[280px]"
          />
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" className="h-8" />}
            >
              Columns
              <IconChevronDown className="ml-1 size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                    className="capitalize"
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Link
            href={`/fundraiser-form?organizationId=${organizationId}`}
            className={buttonVariants({ size: "sm", className: "h-8" })}
          >
            <IconPlus className="size-4" />
            New Fundraiser
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  Loading fundraisers...
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No fundraisers yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-1">
        <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="flex w-full items-center gap-8 lg:w-fit">
          <div className="hidden items-center gap-2 lg:flex">
            <Label htmlFor="rows-per-page" className="text-sm font-medium">
              Rows per page
            </Label>
            <Select
              value={`${pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value));
              }}
            >
              <SelectTrigger className="h-8 w-[70px]" id="rows-per-page">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[5, 10, 20, 30, 40, 50].map((size) => (
                  <SelectItem key={size} value={`${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-fit items-center justify-center text-sm font-medium">
            Page {pageIndex + 1} of {pageCount}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to first page</span>
              <IconChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to previous page</span>
              <IconChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to next page</span>
              <IconChevronRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(pageCount - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to last page</span>
              <IconChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
