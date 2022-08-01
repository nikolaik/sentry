// eslint-disable-next-line simple-import-sort/imports
import {
  filterTypeConfig,
  interchangeableFilterOperators,
  TermOperator,
  Token,
  TokenResult,
} from 'sentry/components/searchSyntax/parser';
import {
  IconArrow,
  IconClock,
  IconDelete,
  IconExclamation,
  IconStar,
  IconTag,
  IconToggle,
  IconUser,
} from 'sentry/icons';
import {t} from 'sentry/locale';

import {ItemType, SearchGroup, SearchItem, Shortcut, ShortcutType} from './types';
import {Tag} from 'sentry/types';
import {FieldKind, getFieldDefinition} from 'sentry/utils/fields';

export function addSpace(query = '') {
  if (query.length !== 0 && query[query.length - 1] !== ' ') {
    return query + ' ';
  }

  return query;
}

export function removeSpace(query = '') {
  if (query[query.length - 1] === ' ') {
    return query.slice(0, query.length - 1);
  }

  return query;
}

/**
 * Given a query, and the current cursor position, return the string-delimiting
 * index of the search term designated by the cursor.
 */
export function getLastTermIndex(query: string, cursor: number) {
  // TODO: work with quoted-terms
  const cursorOffset = query.slice(cursor).search(/\s|$/);
  return cursor + (cursorOffset === -1 ? 0 : cursorOffset);
}

/**
 * Returns an array of query terms, including incomplete terms
 *
 * e.g. ["is:unassigned", "browser:\"Chrome 33.0\"", "assigned"]
 */
export function getQueryTerms(query: string, cursor: number) {
  return query.slice(0, cursor).match(/\S+:"[^"]*"?|\S+/g);
}

function getTitleForType(type: ItemType) {
  if (type === ItemType.TAG_VALUE) {
    return t('Values');
  }

  if (type === ItemType.RECENT_SEARCH) {
    return t('Recent Searches');
  }

  if (type === ItemType.DEFAULT) {
    return t('Common Search Terms');
  }

  if (type === ItemType.TAG_OPERATOR) {
    return t('Operator Helpers');
  }

  if (type === ItemType.PROPERTY) {
    return t('Properties');
  }

  return t('Keys');
}

function getIconForTypeAndTag(type: ItemType, tagName: string) {
  if (type === ItemType.RECENT_SEARCH) {
    return <IconClock size="xs" />;
  }

  if (type === ItemType.DEFAULT) {
    return <IconStar size="xs" />;
  }

  // Change based on tagName and default to "icon-tag"
  switch (tagName) {
    case 'is':
      return <IconToggle size="xs" />;
    case 'assigned':
    case 'bookmarks':
      return <IconUser size="xs" />;
    case 'firstSeen':
    case 'lastSeen':
    case 'event.timestamp':
      return <IconClock size="xs" />;
    default:
      return <IconTag size="xs" />;
  }
}

const filterSearchItems = (
  searchItems: SearchItem[],
  recentSearchItems?: SearchItem[],
  maxSearchItems?: number,
  queryCharsLeft?: number
) => {
  if (maxSearchItems && maxSearchItems > 0) {
    searchItems = searchItems.filter(
      (value: SearchItem, index: number) =>
        index < maxSearchItems || value.ignoreMaxSearchItems
    );
  }

  if (queryCharsLeft || queryCharsLeft === 0) {
    searchItems = searchItems.flatMap(item => {
      if (!item.children) {
        if (!item.value || item.value.length <= queryCharsLeft) {
          return [item];
        }
        return [];
      }

      const newItem = {
        ...item,
        children: item.children.filter(
          child => !child.value || child.value.length <= queryCharsLeft
        ),
      };

      if (newItem.children.length === 0) {
        return [];
      }

      return [newItem];
    });
    searchItems = searchItems.filter(
      (value: SearchItem) => !value.value || value.value.length <= queryCharsLeft
    );

    if (recentSearchItems) {
      recentSearchItems = recentSearchItems.filter(
        (value: SearchItem) => !value.value || value.value.length <= queryCharsLeft
      );
    }
  }

  return {searchItems, recentSearchItems};
};

export function createSearchGroups(
  searchItems: SearchItem[],
  recentSearchItems: SearchItem[] | undefined,
  tagName: string,
  type: ItemType,
  maxSearchItems?: number,
  queryCharsLeft?: number,
  isDefaultState?: boolean
) {
  const activeSearchItem = 0;
  const {searchItems: filteredSearchItems, recentSearchItems: filteredRecentSearchItems} =
    filterSearchItems(searchItems, recentSearchItems, maxSearchItems, queryCharsLeft);

  const searchGroup: SearchGroup = {
    title: getTitleForType(type),
    type: type === ItemType.INVALID_TAG ? type : 'header',
    icon: getIconForTypeAndTag(type, tagName),
    children: [...filteredSearchItems],
  };

  const recentSearchGroup: SearchGroup | undefined =
    filteredRecentSearchItems && filteredRecentSearchItems.length > 0
      ? {
          title: t('Recent Searches'),
          type: 'header',
          icon: <IconClock size="xs" />,
          children: [...filteredRecentSearchItems],
        }
      : undefined;

  if (searchGroup.children && !!searchGroup.children.length) {
    searchGroup.children[activeSearchItem] = {
      ...searchGroup.children[activeSearchItem],
    };
  }

  const flatSearchItems = filteredSearchItems.flatMap(item => {
    if (item.children) {
      if (!item.value) {
        return [...item.children];
      }
      return [item, ...item.children];
    }
    return [item];
  });

  if (isDefaultState) {
    // Recent searches first in default state.
    return {
      searchGroups: [...(recentSearchGroup ? [recentSearchGroup] : []), searchGroup],
      flatSearchItems: [
        ...(recentSearchItems ? recentSearchItems : []),
        ...flatSearchItems,
      ],
      activeSearchItem: -1,
    };
  }

  return {
    searchGroups: [searchGroup, ...(recentSearchGroup ? [recentSearchGroup] : [])],
    flatSearchItems: [
      ...flatSearchItems,
      ...(recentSearchItems ? recentSearchItems : []),
    ],
    activeSearchItem: -1,
  };
}

export function generateOperatorEntryMap(tag: string) {
  return {
    [TermOperator.Default]: {
      type: ItemType.TAG_OPERATOR,
      value: ':',
      desc: `${tag}:${t('[value]')}`,
      documentation: 'is equal to',
    },
    [TermOperator.GreaterThanEqual]: {
      type: ItemType.TAG_OPERATOR,
      value: ':>=',
      desc: `${tag}:${t('>=[value]')}`,
      documentation: 'is greater than or equal to',
    },
    [TermOperator.LessThanEqual]: {
      type: ItemType.TAG_OPERATOR,
      value: ':<=',
      desc: `${tag}:${t('<=[value]')}`,
      documentation: 'is less than or equal to',
    },
    [TermOperator.GreaterThan]: {
      type: ItemType.TAG_OPERATOR,
      value: ':>',
      desc: `${tag}:${t('>[value]')}`,
      documentation: 'is greater than',
    },
    [TermOperator.LessThan]: {
      type: ItemType.TAG_OPERATOR,
      value: ':<',
      desc: `${tag}:${t('<[value]')}`,
      documentation: 'is less than',
    },
    [TermOperator.Equal]: {
      type: ItemType.TAG_OPERATOR,
      value: ':=',
      desc: `${tag}:${t('=[value]')}`,
      documentation: 'is equal to',
    },
    [TermOperator.NotEqual]: {
      type: ItemType.TAG_OPERATOR,
      value: '!:',
      desc: `!${tag}:${t('[value]')}`,
      documentation: 'is not equal to',
    },
  };
}

export function getValidOps(
  filterToken: TokenResult<Token.Filter>
): readonly TermOperator[] {
  // If the token is invalid we want to use the possible expected types as our filter type
  const validTypes = filterToken.invalid?.expectedType ?? [filterToken.filter];

  // Determine any interchangeable filter types for our valid types
  const interchangeableTypes = validTypes.map(
    type => interchangeableFilterOperators[type] ?? []
  );

  // Combine all types
  const allValidTypes = [...new Set([...validTypes, ...interchangeableTypes.flat()])];

  // Find all valid operations
  const validOps = new Set<TermOperator>(
    allValidTypes.map(type => filterTypeConfig[type].validOps).flat()
  );

  return [...validOps];
}

export const shortcuts: Shortcut[] = [
  {
    text: 'Delete',
    shortcutType: ShortcutType.Delete,
    hotkeys: {
      actual: 'ctrl+option+backspace',
    },
    icon: <IconDelete size="xs" color="gray300" />,
    canRunShortcut: token => {
      return token?.type === Token.Filter;
    },
  },
  {
    text: 'Exclude',
    shortcutType: ShortcutType.Negate,
    hotkeys: {
      actual: 'ctrl+option+1',
    },
    icon: <IconExclamation size="xs" color="gray300" />,
    canRunShortcut: token => {
      return token?.type === Token.Filter && !token.negated;
    },
  },
  {
    text: 'Include',
    shortcutType: ShortcutType.Negate,
    hotkeys: {
      actual: 'ctrl+option+1',
    },
    icon: <IconExclamation size="xs" color="gray300" />,
    canRunShortcut: token => {
      return token?.type === Token.Filter && token.negated;
    },
  },

  {
    text: 'Previous',
    shortcutType: ShortcutType.Previous,
    hotkeys: {
      actual: 'ctrl+option+left',
    },
    icon: <IconArrow direction="left" size="xs" color="gray300" />,
    canRunShortcut: (token, count) => {
      return count > 1 || (count > 0 && token?.type !== Token.Filter);
    },
  },
  {
    text: 'Next',
    shortcutType: ShortcutType.Next,
    hotkeys: {
      actual: 'ctrl+option+right',
    },
    icon: <IconArrow direction="right" size="xs" color="gray300" />,
    canRunShortcut: (token, count) => {
      return count > 1 || (count > 0 && token?.type !== Token.Filter);
    },
  },
];

const getItemTitle = (key: string, kind: FieldKind) => {
  if (kind === FieldKind.FUNCTION) {
    // Replace the function innards with ... for cleanliness
    return key.replace(/\(.*\)/g, '(...)');
  }

  return key;
};

/**
 * Groups tag keys based on the "." character in their key.
 * For example, "device.arch" and "device.name" will be grouped together as children of "device", a non-interactive parent.
 * The parent will become interactive if there exists a key "device".
 */
export const getTagItemsFromKeys = (
  tagKeys: string[],
  supportedTags: {
    [key: string]: Tag;
  }
) => {
  return [...tagKeys]
    .sort((a, b) => a.localeCompare(b))
    .reduce((groups, key) => {
      const keyWithColon = `${key}:`;
      const sections = key.split('.');

      const definition =
        supportedTags[key]?.kind === FieldKind.FUNCTION
          ? getFieldDefinition(key.split('(')[0])
          : getFieldDefinition(key);
      const kind = supportedTags[key]?.kind ?? definition?.kind ?? FieldKind.FIELD;

      const item: SearchItem = {
        value: keyWithColon,
        title: getItemTitle(key, kind),
        documentation: definition?.desc ?? '-',
        kind,
        deprecated: definition?.deprecated,
      };

      const lastGroup = groups.at(-1);

      const [title] = sections;

      if (kind !== FieldKind.FUNCTION && lastGroup) {
        if (lastGroup.children && lastGroup.title === title) {
          lastGroup.children.push(item);
          return groups;
        }

        if (lastGroup.title && lastGroup.title.split('.')[0] === title) {
          if (lastGroup.title === title) {
            return [
              ...groups.slice(0, -1),
              {
                title,
                value: lastGroup.value,
                documentation: lastGroup.documentation,
                kind: lastGroup.kind,
                children: [item],
              },
            ];
          }

          // Add a blank parent if the last group's full key is not the same as the title
          return [
            ...groups.slice(0, -1),
            {
              title,
              value: null,
              documentation: '-',
              kind: lastGroup.kind,
              children: [lastGroup, item],
            },
          ];
        }
      }

      return [...groups, item];
    }, [] as SearchItem[]);
};

/**
 * Sets an item as active within a search group array and returns new search groups without mutating.
 * the item is compared via value, so this function assumes that each value is unique.
 */
export const getSearchGroupWithItemMarkedActive = (
  searchGroups: SearchGroup[],
  currentItem: SearchItem,
  active: boolean
) => {
  return searchGroups.map(group => ({
    ...group,
    children: group.children?.map(item => {
      if (item.value === currentItem.value) {
        return {
          ...item,
          active,
        };
      }

      if (item.children && item.children.length > 0) {
        return {
          ...item,
          children: item.children.map(child => {
            if (child.value === currentItem.value) {
              return {
                ...child,
                active,
              };
            }

            return child;
          }),
        };
      }

      return item;
    }),
  }));
};
