import React from "react";
import SelectComponent from "react-select";
import CreatableSelect from "react-select/creatable";
import { workspaceFloatingZ } from "@/lib/workspaceFloatingLayer";
import type {
  ActionMeta,
  Props as ReactSelectProps,
  SingleValue,
  StylesConfig,
} from "react-select";

export type SelectOption = {
  value: string;
  label: string;
  isDisabled?: boolean;
};

type BaseProps = {
  value: string | null;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  isClearable?: boolean;
  onChange: (value: string | null, action: ActionMeta<SelectOption>) => void;
  onBlur?: () => void;
  className?: string;
  formatCreateLabel?: (input: string) => string;
};

type CreatableProps = {
  isCreatable: true;
  onCreateOption: (value: string) => void;
};

type NonCreatableProps = {
  isCreatable?: false;
  onCreateOption?: never;
};

export type SelectProps = BaseProps & (CreatableProps | NonCreatableProps);

const baseBackground = "var(--workspace-ui-select-menu-bg)";
const hoverBackground = "var(--workspace-ui-select-hover-bg)";
const focusBackground = "var(--workspace-ui-select-focus-bg)";
const neutralBorder = "var(--workspace-border-strong)";

const selectStyles: StylesConfig<SelectOption, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderRadius: 6,
    borderColor: state.isFocused ? "var(--workspace-accent)" : neutralBorder,
    boxShadow: state.isFocused ? "0 0 0 1px var(--workspace-accent)" : "none",
    backgroundColor: state.isFocused ? focusBackground : baseBackground,
    fontSize: "0.875rem",
    color: "var(--workspace-ui-button-text)",
    transition: "all 150ms ease",
    ":hover": {
      borderColor: "var(--workspace-accent)",
      backgroundColor: hoverBackground,
    },
  }),
  valueContainer: (base) => ({
    ...base,
    paddingInline: 10,
    paddingBlock: 6,
  }),
  input: (base) => ({
    ...base,
    color: "var(--workspace-ui-button-text)",
  }),
  singleValue: (base) => ({
    ...base,
    color: "var(--workspace-ui-button-text)",
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused
      ? "var(--workspace-accent)"
      : "var(--workspace-text-soft)",
    ":hover": {
      color: "var(--workspace-accent)",
    },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: "var(--workspace-text-soft)",
    ":hover": {
      color: "var(--workspace-accent)",
    },
  }),
  menu: (provided) => ({
    ...provided,
    backgroundColor: "var(--workspace-ui-select-menu-bg)",
    color: "var(--workspace-ui-button-text)",
    border: "1px solid var(--workspace-border-strong)",
    boxShadow: "var(--workspace-ui-select-menu-shadow)",
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected
      ? focusBackground
      : state.isFocused
        ? hoverBackground
        : "transparent",
    color: "var(--workspace-ui-button-text)",
    cursor: state.isDisabled ? "not-allowed" : base.cursor,
    opacity: state.isDisabled ? 0.5 : 1,
  }),
  placeholder: (base) => ({
    ...base,
    color: "var(--workspace-text-soft)",
  }),
};

export const Select: React.FC<SelectProps> = React.memo(
  ({
    value,
    options,
    placeholder,
    disabled,
    isLoading,
    isClearable = true,
    onChange,
    onBlur,
    className = "",
    isCreatable,
    formatCreateLabel,
    onCreateOption,
  }) => {
    const selectValue = React.useMemo(() => {
      if (!value) return null;
      const existing = options.find((option) => option.value === value);
      if (existing) return existing;
      return { value, label: value, isDisabled: false };
    }, [value, options]);

    const handleChange = (
      option: SingleValue<SelectOption>,
      action: ActionMeta<SelectOption>,
    ) => {
      onChange(option?.value ?? null, action);
    };

    const sharedProps: Partial<ReactSelectProps<SelectOption, false>> = {
      className,
      classNamePrefix: "app-select",
      value: selectValue,
      options,
      onChange: handleChange,
      placeholder,
      isDisabled: disabled,
      isLoading,
      onBlur,
      isClearable,
      styles: selectStyles,
      menuPortalTarget: typeof document !== "undefined" ? document.body : null,
    };

    if (isCreatable) {
      return (
        <CreatableSelect<SelectOption, false>
          {...sharedProps}
          onCreateOption={onCreateOption}
          formatCreateLabel={formatCreateLabel}
        />
      );
    }

    return <SelectComponent<SelectOption, false> {...sharedProps} />;
  },
);

Select.displayName = "Select";
