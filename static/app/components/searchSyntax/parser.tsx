import moment from 'moment';
import {LocationRange} from 'pegjs';

import {t} from 'sentry/locale';
import {
  AggregateParameter,
  AggregateParameterColumn,
  AGGREGATIONS,
  ColumnType,
  isMeasurement,
  isSpanOperationBreakdownField,
  measurementType,
} from 'sentry/utils/discover/fields';
import {
  AggregationKey,
  FieldKind,
  FIELDS,
  FieldValueType,
  getFieldDefinition,
} from 'sentry/utils/fields';

import grammar from './grammar.pegjs';
import {getKeyName} from './utils';

type TextFn = () => string;
type LocationFn = () => LocationRange;

type ListItem<V> = [
  space: ReturnType<TokenConverter['tokenSpaces']>,
  comma: string,
  space: ReturnType<TokenConverter['tokenSpaces']>,
  notComma: undefined,
  value: V | null
];

const listJoiner = <K,>([s1, comma, s2, _, value]: ListItem<K>) => ({
  separator: [s1.value, comma, s2.value].join(''),
  value,
});

/**
 * A token represents a node in the syntax tree. These are all extrapolated
 * from the grammar and may not be named exactly the same.
 */
export enum Token {
  Spaces = 'spaces',
  Filter = 'filter',
  FreeText = 'freeText',
  LogicGroup = 'logicGroup',
  LogicBoolean = 'logicBoolean',
  KeySimple = 'keySimple',
  KeyExplicitTag = 'keyExplicitTag',
  KeyAggregate = 'keyAggregate',
  KeyAggregateArgs = 'keyAggregateArgs',
  KeyAggregateParam = 'keyAggregateParam',
  ValueIso8601Date = 'valueIso8601Date',
  ValueRelativeDate = 'valueRelativeDate',
  ValueDuration = 'valueDuration',
  ValuePercentage = 'valuePercentage',
  ValueBoolean = 'valueBoolean',
  ValueNumber = 'valueNumber',
  ValueText = 'valueText',
  ValueNumberList = 'valueNumberList',
  ValueTextList = 'valueTextList',
}

/**
 * An operator in a key value term
 */
export enum TermOperator {
  Default = '',
  GreaterThanEqual = '>=',
  LessThanEqual = '<=',
  GreaterThan = '>',
  LessThan = '<',
  Equal = '=',
  NotEqual = '!=',
}

/**
 * Logic operators
 */
export enum BooleanOperator {
  And = 'AND',
  Or = 'OR',
}

/**
 * The Token.Filter may be one of many types of filters. This enum declares the
 * each variant filter type.
 */
export enum FilterType {
  Text = 'text',
  TextIn = 'textIn',
  Date = 'date',
  SpecificDate = 'specificDate',
  RelativeDate = 'relativeDate',
  Duration = 'duration',
  Numeric = 'numeric',
  NumericIn = 'numericIn',
  Boolean = 'boolean',
  AggregateDuration = 'aggregateDuration',
  AggregatePercentage = 'aggregatePercentage',
  AggregateNumeric = 'aggregateNumeric',
  AggregateDate = 'aggregateDate',
  AggregateRelativeDate = 'aggregateRelativeDate',
  Has = 'has',
  Is = 'is',
}

type AggregateFilter =
  | FilterType.AggregateDate
  | FilterType.AggregateDuration
  | FilterType.AggregateNumeric
  | FilterType.AggregatePercentage
  | FilterType.AggregateRelativeDate;

export const allOperators = [
  TermOperator.Default,
  TermOperator.GreaterThanEqual,
  TermOperator.LessThanEqual,
  TermOperator.GreaterThan,
  TermOperator.LessThan,
  TermOperator.Equal,
  TermOperator.NotEqual,
] as const;

const basicOperators = [TermOperator.Default, TermOperator.NotEqual] as const;

/**
 * Map of certain filter types to other filter types with applicable operators
 * e.g. SpecificDate can use the operators from Date to become a Date filter.
 */
export const interchangeableFilterOperators = {
  [FilterType.SpecificDate]: [FilterType.Date],
  [FilterType.Date]: [FilterType.SpecificDate],
};

const textKeys = [Token.KeySimple, Token.KeyExplicitTag] as const;

const numberUnits = {
  b: 1_000_000_000,
  m: 1_000_000,
  k: 1_000,
};

/**
 * This constant-type configuration object declares how each filter type
 * operates. Including what types of keys, operators, and values it may
 * receive.
 *
 * This configuration is used to generate the discriminate Filter type that is
 * returned from the tokenFilter converter.
 */
export const filterTypeConfig = {
  [FilterType.Text]: {
    validKeys: textKeys,
    validOps: basicOperators,
    validValues: [Token.ValueText],
    canNegate: true,
  },
  [FilterType.TextIn]: {
    validKeys: textKeys,
    validOps: [],
    validValues: [Token.ValueTextList],
    canNegate: true,
  },
  [FilterType.Date]: {
    validKeys: [Token.KeySimple],
    validOps: allOperators,
    validValues: [Token.ValueIso8601Date],
    canNegate: false,
  },
  [FilterType.SpecificDate]: {
    validKeys: [Token.KeySimple],
    validOps: [],
    validValues: [Token.ValueIso8601Date],
    canNegate: false,
  },
  [FilterType.RelativeDate]: {
    validKeys: [Token.KeySimple],
    validOps: [],
    validValues: [Token.ValueRelativeDate],
    canNegate: false,
  },
  [FilterType.Duration]: {
    validKeys: [Token.KeySimple],
    validOps: allOperators,
    validValues: [Token.ValueDuration],
    canNegate: true,
  },
  [FilterType.Numeric]: {
    validKeys: [Token.KeySimple],
    validOps: allOperators,
    validValues: [Token.ValueNumber],
    canNegate: true,
  },
  [FilterType.NumericIn]: {
    validKeys: [Token.KeySimple],
    validOps: [],
    validValues: [Token.ValueNumberList],
    canNegate: true,
  },
  [FilterType.Boolean]: {
    validKeys: [Token.KeySimple],
    validOps: basicOperators,
    validValues: [Token.ValueBoolean],
    canNegate: true,
  },
  [FilterType.AggregateDuration]: {
    validKeys: [Token.KeyAggregate],
    validOps: allOperators,
    validValues: [Token.ValueDuration],
    canNegate: true,
  },
  [FilterType.AggregateNumeric]: {
    validKeys: [Token.KeyAggregate],
    validOps: allOperators,
    validValues: [Token.ValueNumber],
    canNegate: true,
  },
  [FilterType.AggregatePercentage]: {
    validKeys: [Token.KeyAggregate],
    validOps: allOperators,
    validValues: [Token.ValuePercentage],
    canNegate: true,
  },
  [FilterType.AggregateDate]: {
    validKeys: [Token.KeyAggregate],
    validOps: allOperators,
    validValues: [Token.ValueIso8601Date],
    canNegate: true,
  },
  [FilterType.AggregateRelativeDate]: {
    validKeys: [Token.KeyAggregate],
    validOps: allOperators,
    validValues: [Token.ValueRelativeDate],
    canNegate: true,
  },
  [FilterType.Has]: {
    validKeys: [Token.KeySimple],
    validOps: basicOperators,
    validValues: [],
    canNegate: true,
  },
  [FilterType.Is]: {
    validKeys: [Token.KeySimple],
    validOps: basicOperators,
    validValues: [Token.ValueText],
    canNegate: true,
  },
} as const;

type FilterTypeConfig = typeof filterTypeConfig;

/**
 * Object representing an invalid filter state
 */
type InvalidFilter = {
  /**
   * The message indicating why the filter is invalid
   */
  reason: string;
  /**
   * In the case where a filter is invalid, we may be expecting a different
   * type for this filter based on the key. This can be useful to hint to the
   * user what values they should be providing.
   *
   * This may be multiple filter types.
   */
  expectedType?: FilterType[];
};

type FilterMap = {
  [F in keyof FilterTypeConfig]: {
    /**
     * The filter type being represented
     */
    filter: F;
    /**
     * When a filter is marked as 'invalid' a reason is given. If the filter is
     * not invalid this will always be null
     */
    invalid: InvalidFilter | null;
    /**
     * The key of the filter
     */
    key: KVConverter<FilterTypeConfig[F]['validKeys'][number]>;
    /**
     * Indicates if the filter has been negated
     */
    negated: FilterTypeConfig[F]['canNegate'] extends true ? boolean : false;
    /**
     * The operator applied to the filter
     */
    operator: FilterTypeConfig[F]['validOps'][number];
    type: Token.Filter;
    /**
     * The value of the filter
     */
    value: KVConverter<FilterTypeConfig[F]['validValues'][number]>;
  };
};

type TextFilter = FilterMap[FilterType.Text];
type InFilter = FilterMap[FilterType.TextIn] | FilterMap[FilterType.NumericIn];

/**
 * The Filter type discriminates on the FilterType enum using the `filter` key.
 *
 * When receiving this type you may narrow it to a specific filter by checking
 * this field. This will give you proper types on what the key, value, and
 * operator results are.
 */
type FilterResult = FilterMap[FilterType];

type TokenConverterOpts = {
  config: SearchConfig;
  location: LocationFn;
  text: TextFn;
};

/**
 * Used to construct token results via the token grammar
 */
export class TokenConverter {
  text: TextFn;
  location: LocationFn;
  config: SearchConfig;

  constructor({text, location, config}: TokenConverterOpts) {
    this.text = text;
    this.location = location;
    this.config = config;
  }

  /**
   * Validates various types of keys
   */
  keyValidation = {
    isNumeric: (key: string) =>
      this.config.numericKeys.has(key) ||
      isMeasurement(key) ||
      isSpanOperationBreakdownField(key),
    isBoolean: (key: string) => this.config.booleanKeys.has(key),
    isPercentage: (key: string) => this.config.percentageKeys.has(key),
    isDate: (key: string) => this.config.dateKeys.has(key),
    isDuration: (key: string) =>
      this.config.durationKeys.has(key) ||
      isSpanOperationBreakdownField(key) ||
      measurementType(key) === 'duration',
  };

  /**
   * Creates shared `text` and `location` keys.
   */
  get defaultTokenFields() {
    return {
      text: this.text(),
      location: this.location(),
    };
  }

  tokenSpaces = (value: string) => ({
    ...this.defaultTokenFields,
    type: Token.Spaces as const,
    value,
  });

  tokenFilter = <T extends FilterType>(
    filter: T,
    key: FilterMap[T]['key'],
    value: FilterMap[T]['value'],
    operator: FilterMap[T]['operator'] | undefined,
    negated: FilterMap[T]['negated']
  ) => {
    const filterToken = {
      type: Token.Filter as const,
      filter,
      key,
      value,
      negated,
      operator: operator ?? TermOperator.Default,
      invalid: this.checkInvalidFilter(filter, key, value),
    } as FilterResult;

    return {
      ...this.defaultTokenFields,
      ...filterToken,
    };
  };

  tokenFreeText = (value: string, quoted: boolean) => ({
    ...this.defaultTokenFields,
    type: Token.FreeText as const,
    value,
    quoted,
  });

  tokenLogicGroup = (
    inner: Array<
      | ReturnType<TokenConverter['tokenLogicBoolean']>
      | ReturnType<TokenConverter['tokenFilter']>
      | ReturnType<TokenConverter['tokenFreeText']>
    >
  ) => ({
    ...this.defaultTokenFields,
    type: Token.LogicGroup as const,
    inner,
  });

  tokenLogicBoolean = (bool: BooleanOperator) => ({
    ...this.defaultTokenFields,
    type: Token.LogicBoolean as const,
    value: bool,
  });

  tokenKeySimple = (value: string, quoted: boolean) => ({
    ...this.defaultTokenFields,
    type: Token.KeySimple as const,
    value,
    quoted,
  });

  tokenKeyExplicitTag = (
    prefix: string,
    key: ReturnType<TokenConverter['tokenKeySimple']>
  ) => ({
    ...this.defaultTokenFields,
    type: Token.KeyExplicitTag as const,
    prefix,
    key,
  });

  tokenKeyAggregateParam = (value: string, quoted: boolean) => ({
    ...this.defaultTokenFields,
    type: Token.KeyAggregateParam as const,
    value,
    quoted,
  });

  tokenKeyAggregate = (
    name: ReturnType<TokenConverter['tokenKeySimple']>,
    args: ReturnType<TokenConverter['tokenKeyAggregateArgs']> | null,
    argsSpaceBefore: ReturnType<TokenConverter['tokenSpaces']>,
    argsSpaceAfter: ReturnType<TokenConverter['tokenSpaces']>
  ) => ({
    ...this.defaultTokenFields,
    type: Token.KeyAggregate as const,
    name,
    args,
    argsSpaceBefore,
    argsSpaceAfter,
  });

  tokenKeyAggregateArgs = (
    arg1: ReturnType<TokenConverter['tokenKeyAggregateParam']>,
    args: ListItem<ReturnType<TokenConverter['tokenKeyAggregateParam']>>[]
  ) => ({
    ...this.defaultTokenFields,
    type: Token.KeyAggregateArgs as const,
    args: [{separator: '', value: arg1}, ...args.map(listJoiner)],
  });

  tokenValueIso8601Date = (value: string) => ({
    ...this.defaultTokenFields,
    type: Token.ValueIso8601Date as const,
    value: moment(value),
  });

  tokenValueRelativeDate = (
    value: string,
    sign: '-' | '+',
    unit: 'w' | 'd' | 'h' | 'm'
  ) => ({
    ...this.defaultTokenFields,
    type: Token.ValueRelativeDate as const,
    value: Number(value),
    sign,
    unit,
  });

  tokenValueDuration = (
    value: string,
    unit: 'ms' | 's' | 'min' | 'm' | 'hr' | 'h' | 'day' | 'd' | 'wk' | 'w'
  ) => ({
    ...this.defaultTokenFields,

    type: Token.ValueDuration as const,
    value: Number(value),
    unit,
  });

  tokenValuePercentage = (value: string) => ({
    ...this.defaultTokenFields,
    type: Token.ValuePercentage as const,
    value: Number(value),
  });

  tokenValueBoolean = (value: string) => ({
    ...this.defaultTokenFields,
    type: Token.ValueBoolean as const,
    value: ['1', 'true'].includes(value.toLowerCase()),
  });

  tokenValueNumber = (value: string, unit: string) => ({
    ...this.defaultTokenFields,
    type: Token.ValueNumber as const,
    value,
    rawValue: Number(value) * (numberUnits[unit] ?? 1),
    unit,
  });

  tokenValueNumberList = (
    item1: ReturnType<TokenConverter['tokenValueNumber']>,
    items: ListItem<ReturnType<TokenConverter['tokenValueNumber']>>[]
  ) => ({
    ...this.defaultTokenFields,
    type: Token.ValueNumberList as const,
    items: [{separator: '', value: item1}, ...items.map(listJoiner)],
  });

  tokenValueTextList = (
    item1: ReturnType<TokenConverter['tokenValueText']>,
    items: ListItem<ReturnType<TokenConverter['tokenValueText']>>[]
  ) => ({
    ...this.defaultTokenFields,
    type: Token.ValueTextList as const,
    items: [{separator: '', value: item1}, ...items.map(listJoiner)],
  });

  tokenValueText = (value: string, quoted: boolean) => ({
    ...this.defaultTokenFields,
    type: Token.ValueText as const,
    value,
    quoted,
  });

  /**
   * This method is used while tokenizing to predicate whether a filter should
   * match or not. We do this because not all keys are valid for specific
   * filter types. For example, boolean filters should only match for keys
   * which can be filtered as booleans.
   *
   * See [0] and look for &{ predicate } to understand how predicates are
   * declared in the grammar
   *
   * [0]:https://pegjs.org/documentation
   */
  predicateFilter = <T extends FilterType>(type: T, key: FilterMap[T]['key']) => {
    // @ts-expect-error Unclear why this isn’t resolving correctly
    const keyName = getKeyName(key);
    const keyIsAggregate = getFieldDefinition(keyName)?.kind === FieldKind.FUNCTION;

    const {isNumeric, isDuration, isBoolean, isDate} = this.keyValidation;

    const checkAggregate = (check: (s: string) => boolean) => {
      const aggregateKey = key as FilterMap[AggregateFilter]['key'];

      return (
        check(keyName) &&
        (!aggregateKey.args?.args ||
          aggregateKey.args?.args.some(arg => check(arg?.value?.value ?? '')))
      );
    };

    // Be very strict with aggregate keys
    if (keyIsAggregate) {
      switch (type) {
        case FilterType.AggregateDuration:
          return checkAggregate(isDuration);
        case FilterType.AggregateNumeric:
        case FilterType.AggregateDate:
        case FilterType.AggregatePercentage:
        case FilterType.AggregateRelativeDate:
          return true;

        // Fallback all aggregate keys that aren't aggregates into text filters. ('p95:>50' will parse as a text filter)
        case FilterType.Text:
          return true;

        default:
          return false;
      }
    }

    switch (type) {
      case FilterType.Numeric:
      case FilterType.NumericIn:
        return isNumeric(keyName);

      case FilterType.Duration:
        return isDuration(keyName);

      case FilterType.Boolean:
        return isBoolean(keyName);

      case FilterType.Date:
      case FilterType.RelativeDate:
      case FilterType.SpecificDate:
        return isDate(keyName);

      default:
        return true;
    }
  };

  /**
   * Predicates weather a text filter have operators for specific keys.
   */
  predicateTextOperator = (key: TextFilter['key']) =>
    this.config.textOperatorKeys.has(getKeyName(key));

  /**
   * Checks a filter against some non-grammar validation rules
   */
  checkInvalidFilter = <T extends FilterType>(
    filter: T,
    key: FilterMap[T]['key'],
    value: FilterMap[T]['value']
  ) => {
    // Text filter is the "fall through" filter that will match when other
    // filter predicates fail.
    if (filter === FilterType.Text) {
      return this.checkInvalidTextFilter(
        key as TextFilter['key'],
        value as TextFilter['value']
      );
    }

    if (filter === FilterType.Is || filter === FilterType.Has) {
      return this.checkInvalidTextValue(value as TextFilter['value']);
    }

    if ([FilterType.TextIn, FilterType.NumericIn].includes(filter)) {
      return this.checkInvalidInFilter(value as InFilter['value']);
    }

    const isAggregateFilter = [
      FilterType.AggregateDate,
      FilterType.AggregateDuration,
      FilterType.AggregateNumeric,
      FilterType.AggregatePercentage,
      FilterType.AggregateRelativeDate,
    ].includes(filter);

    if (isAggregateFilter) {
      return this.checkInvalidAggregateFilter(
        filter as AggregateFilter,
        key as FilterMap[AggregateFilter]['key'],
        value as FilterMap[AggregateFilter]['value']
      );
    }

    return null;
  };

  /**
   * Validates the value provided to the aggregation filter.
   * If valid, returns null - otherwise, returns a reason it is invalid.
   */
  checkInvalidAggregateFilterValue = (
    filterType: AggregateFilter,
    key: FilterMap[AggregateFilter]['key'],
    value: FilterMap[AggregateFilter]['value']
  ) => {
    const keyName = key.name.text;

    const {isNumeric, isDuration, isDate, isPercentage} = this.keyValidation;
    const definition = getFieldDefinition(keyName);

    const wrongValueTypeReason = {
      reason: `'${keyName}' returns a ${
        `${definition?.valueType}` ?? 'different value type.'
      }; '${value.text}' is not valid here.`,
    };

    switch (filterType) {
      case FilterType.AggregateRelativeDate:
      case FilterType.AggregateDate:
        if (!isDate(keyName)) {
          return wrongValueTypeReason;
        }
        break;
      case FilterType.AggregateDuration:
        if (!isDuration(keyName)) {
          return wrongValueTypeReason;
        }
        break;
      case FilterType.AggregatePercentage:
        if (!isPercentage(keyName)) {
          return wrongValueTypeReason;
        }
        break;
      case FilterType.AggregateNumeric:
        if (!isNumeric(keyName)) {
          return wrongValueTypeReason;
        }
        break;
      default:
        return null;
    }

    return null;
  };

  /**
   * Validates the aggregate filter value and arguments against their known types.
   * If valid, returns null - otherwise, returns a reason it is invalid.
   */
  checkInvalidAggregateFilter = (
    filterType: AggregateFilter,
    key: FilterMap[AggregateFilter]['key'],
    value: FilterMap[AggregateFilter]['value']
  ) => {
    const keyName = key.name.text;

    const invalidValueReason = this.checkInvalidAggregateFilterValue(
      filterType,
      key,
      value
    );

    if (invalidValueReason) {
      return invalidValueReason;
    }

    const aggregation = AGGREGATIONS[keyName as AggregationKey];

    if (!aggregation) {
      return null;
    }

    const numExpectedArguments = aggregation.parameters.length;
    const numProvidedArguments = key.args?.args?.length ?? 0;

    // Loop through each
    for (
      let argIndex = 0;
      argIndex < Math.max(numExpectedArguments, numProvidedArguments);
      argIndex++
    ) {
      const parameterDefinition = aggregation.parameters[argIndex];
      const parameterValue = key.args?.args[argIndex]?.value?.value;

      const reason = validateAggregateParameter({
        keyName,
        parameterDefinition,
        parameterValue,
        position: argIndex + 1,
        numExpectedArguments,
      });

      if (reason) {
        return reason;
      }
    }

    return null;
  };

  /**
   * Validates text filters which may have failed predication
   */
  checkInvalidTextFilter = (key: TextFilter['key'], value: TextFilter['value']) => {
    // Explicit tag keys will always be treated as text filters
    if (key.type === Token.KeyExplicitTag) {
      return this.checkInvalidTextValue(value);
    }

    const keyName = getKeyName(key);
    const keyIsAggregate = getFieldDefinition(keyName)?.kind === FieldKind.FUNCTION;

    // Let text keys that match aggregate filters go through
    if (!keyIsAggregate) {
      if (this.keyValidation.isDuration(keyName)) {
        return {
          reason: t('Invalid duration. Expected number followed by duration unit suffix'),
          expectedType: [FilterType.Duration],
        };
      }

      if (this.keyValidation.isDate(keyName)) {
        const date = new Date();
        date.setSeconds(0);
        date.setMilliseconds(0);
        const example = date.toISOString();

        return {
          reason: t(
            'Invalid date format. Expected +/-duration (e.g. +1h) or ISO 8601-like (e.g. %s or %s)',
            example.slice(0, 10),
            example
          ),
          expectedType: [
            FilterType.Date,
            FilterType.SpecificDate,
            FilterType.RelativeDate,
          ],
        };
      }

      if (this.keyValidation.isBoolean(keyName)) {
        return {
          reason: t('Invalid boolean. Expected true, 1, false, or 0.'),
          expectedType: [FilterType.Boolean],
        };
      }

      if (this.keyValidation.isNumeric(keyName)) {
        return {
          reason: t(
            'Invalid number. Expected number then optional k, m, or b suffix (e.g. 500k)'
          ),
          expectedType: [FilterType.Numeric, FilterType.NumericIn],
        };
      }
    }

    return this.checkInvalidTextValue(value);
  };

  /**
   * Validates the value of a text filter
   */
  checkInvalidTextValue = (value: TextFilter['value']) => {
    if (!value.quoted && /(^|[^\\])"/.test(value.value)) {
      return {reason: t('Quotes must enclose text or be escaped')};
    }

    if (!value.quoted && value.value === '') {
      return {reason: t('Filter must have a value')};
    }

    return null;
  };

  /**
   * Validates IN filter values do not have an missing elements
   */
  checkInvalidInFilter = ({items}: InFilter['value']) => {
    const hasEmptyValue = items.some(item => item.value === null);

    if (hasEmptyValue) {
      return {reason: t('Lists should not have empty values')};
    }

    return null;
  };
}

const getValueType = (key: string) => {
  if (!isNaN(parseFloat(key))) {
    return FieldValueType.NUMBER as ColumnType;
  }

  return FieldValueType.STRING as ColumnType;
};

/**
 * Maps token conversion methods to their result types
 */
type ConverterResultMap = {
  [K in keyof TokenConverter & `token${string}`]: ReturnType<TokenConverter[K]>;
};

type Converter = keyof ConverterResultMap;

/**
 * Converter keys specific to Key and Value tokens
 */
type KVTokens = Converter & `token${'Key' | 'Value'}${string}`;

/**
 * Similar to TokenResult, but only includes Key* and Value* token type
 * results. This avoids a circular reference when this is used for the Filter
 * token converter result
 */
type KVConverter<T extends Token> = ConverterResultMap[KVTokens] & {type: T};

/**
 * Each token type is discriminated by the `type` field.
 */
export type TokenResult<T extends Token> = ConverterResultMap[Converter] & {type: T};

/**
 * Result from parsing a search query.
 */
export type ParseResult = Array<
  | TokenResult<Token.LogicBoolean>
  | TokenResult<Token.LogicGroup>
  | TokenResult<Token.Filter>
  | TokenResult<Token.FreeText>
  | TokenResult<Token.Spaces>
>;

/**
 * Configures behavior of search parsing
 */
export type SearchConfig = {
  /**
   * Enables boolean filtering (AND / OR)
   */
  allowBoolean: boolean;
  /**
   * Keys considered valid for boolean filter types
   */
  booleanKeys: Set<string>;
  /**
   * Keys considered valid for date filter types
   */
  dateKeys: Set<string>;
  /**
   * Keys which are considered valid for duration filters
   */
  durationKeys: Set<string>;
  /**
   * Keys considered valid for numeric filter types
   */
  numericKeys: Set<string>;
  /**
   * Keys considered valid for the percentage aggregate and may have percentage
   * search values
   */
  percentageKeys: Set<string>;
  /**
   * Text filter keys we allow to have operators
   */
  textOperatorKeys: Set<string>;
};

const getKeySet = (options: {
  allowGenericAggregations: boolean;
  valueTypes: FieldValueType[];
  preFilter?: (key: string) => boolean;
}) => {
  let keys = Object.keys(FIELDS);

  if (options.preFilter) {
    keys = keys.filter(options.preFilter);
  }

  return new Set(
    keys.filter(fieldKey => {
      const fieldDef = getFieldDefinition(fieldKey);

      if (fieldDef) {
        // Is a strict percentage field
        if (fieldDef?.valueType && options.valueTypes.includes(fieldDef.valueType)) {
          return true;
        }

        // Is an aggregation that takes any values
        if (
          options.allowGenericAggregations &&
          fieldDef.kind === FieldKind.FUNCTION &&
          !fieldDef.valueType
        ) {
          return true;
        }
      }

      return false;
    })
  );
};

const defaultConfig: SearchConfig = {
  textOperatorKeys: getKeySet({
    valueTypes: [FieldValueType.STRING],
    allowGenericAggregations: false,
    preFilter: fieldKey => {
      const fieldDef = getFieldDefinition(fieldKey);

      return fieldDef?.allowTextOperators ?? false;
    },
  }),
  durationKeys: getKeySet({
    valueTypes: [FieldValueType.DURATION],
    allowGenericAggregations: true,
  }),
  percentageKeys: getKeySet({
    valueTypes: [FieldValueType.PERCENTAGE],
    allowGenericAggregations: true,
  }),
  numericKeys: getKeySet({
    valueTypes: [FieldValueType.NUMBER, FieldValueType.INTEGER],
    allowGenericAggregations: true,
  }),
  dateKeys: getKeySet({
    valueTypes: [FieldValueType.DATE],
    allowGenericAggregations: true,
  }),
  booleanKeys: getKeySet({
    valueTypes: [FieldValueType.BOOLEAN],
    allowGenericAggregations: true,
  }),
  allowBoolean: true,
};

const options = {
  TokenConverter,
  TermOperator,
  FilterType,
  config: defaultConfig,
};

/**
 * Parse a search query into a ParseResult. Failing to parse the search query
 * will result in null.
 */
export function parseSearch(query: string): ParseResult | null {
  try {
    return grammar.parse(query, options);
  } catch (e) {
    // TODO(epurkhiser): Should we capture these errors somewhere?
  }

  return null;
}

/**
 * Join a parsed query array into a string.
 * Should handle null cases to chain easily with parseSearch.
 * Option to add a leading space when applicable (e.g. to combine with other strings).
 * Option to add a space between elements (e.g. for when no Token.Spaces present).
 */
export function joinQuery(
  parsedTerms: ParseResult | null | undefined,
  leadingSpace?: boolean,
  additionalSpaceBetween?: boolean
): string {
  if (!parsedTerms || !parsedTerms.length) {
    return '';
  }

  return (
    (leadingSpace ? ' ' : '') +
    (parsedTerms.length === 1
      ? parsedTerms[0].text
      : parsedTerms.map(p => p.text).join(additionalSpaceBetween ? ' ' : ''))
  );
}

const validateAggregateParameterColumn = ({
  keyName,
  parameterDefinition,
  position,
  parameterValue,
}: {
  keyName: string;
  parameterDefinition: AggregateParameterColumn;
  parameterValue: string;
  position: number;
}) => {
  const definition = getFieldDefinition(keyName);

  if (typeof parameterDefinition.columnTypes === 'function') {
    if (
      !parameterDefinition.columnTypes({
        name: parameterValue,
        dataType: definition?.valueType,
      })
    ) {
      return {
        reason: `Argument ${position} is an invalid column type.`,
      };
    }
  } else if (Array.isArray(parameterDefinition.columnTypes)) {
    const columnParameterFieldDefinition = getFieldDefinition(parameterValue);

    if (!columnParameterFieldDefinition) {
      return {
        reason: `${keyName} expects argument ${position} to be a column.`,
      };
    }

    if (
      !parameterDefinition.columnTypes.some(
        columnOrMetricType =>
          columnOrMetricType === columnParameterFieldDefinition?.valueType
      )
    ) {
      return {
        reason: `${keyName} expects argument ${position} to be a column of type: ${parameterDefinition.columnTypes.join(
          ', '
        )}.`,
      };
    }
  }

  return null;
};

/**
 * Validates a value against the provided aggregate parameter definition.
 * Returns null if valid - otherwise, returns a reason.
 */
const validateAggregateParameter = ({
  keyName,
  parameterDefinition,
  parameterValue,
  position,
  numExpectedArguments,
}: {
  keyName: string;
  numExpectedArguments: number;
  position: number;
  parameterDefinition?: AggregateParameter;
  parameterValue?: string;
}) => {
  if ((parameterDefinition?.required && !parameterValue) || !parameterDefinition) {
    return {
      reason: `${keyName} is expecting ${numExpectedArguments} arguments.`,
    };
  }

  if (!parameterValue) {
    return null;
  }

  switch (parameterDefinition.kind) {
    case 'column':
      return validateAggregateParameterColumn({
        keyName,
        parameterDefinition,
        position,
        parameterValue,
      });
    case 'dropdown': {
      if (!parameterDefinition.options.find(option => option.value === parameterValue)) {
        return {
          reason: `${keyName} expects argument ${position} to be one of: ${parameterDefinition.options
            .map(option => `'${option.value}'`)
            .join(', ')}`,
        };
      }
      return null;
    }
    case 'value': {
      if (getValueType(parameterValue) !== parameterDefinition.dataType) {
        return {
          reason: `${keyName} expects arument ${position} to be of type ${parameterDefinition.dataType}`,
        };
      }
      return null;
    }

    default:
      return null;
  }
};
