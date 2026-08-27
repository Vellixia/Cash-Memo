import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const compatibilityVariantClasses = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary:
    "border-border bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_88%,var(--foreground)_12%)]",
  quiet:
    "border-border bg-background text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
  danger:
    "bg-destructive text-destructive-foreground hover:bg-[color-mix(in_srgb,var(--destructive)_92%,black_8%)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline:
    "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-[color-mix(in_srgb,var(--destructive)_92%,black_8%)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
  ghost:
    "text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
  link: "text-primary underline-offset-4 hover:underline",
} as const

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-xl border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: compatibilityVariantClasses,
      size: {
        default:
          "min-h-11 gap-2 px-4 py-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "min-h-9 gap-1 rounded-lg px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-10 gap-1.5 rounded-xl px-3 text-sm has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-12 gap-2 px-5 py-3 text-sm has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-11",
        "icon-xs": "size-9 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-10 rounded-xl",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
