import {Component} from 'react';
import isEqual from 'lodash/isEqual';

import {Client} from 'sentry/api';
import {isSelectionEqual} from 'sentry/components/organizations/pageFilters/utils';
import {t} from 'sentry/locale';
import MemberListStore from 'sentry/stores/memberListStore';
import {OrganizationSummary, PageFilters} from 'sentry/types';
import {TableDataRow} from 'sentry/utils/discover/discoverQuery';
import getDynamicText from 'sentry/utils/getDynamicText';

import {getDatasetConfig} from '../datasetConfig/base';
import {Widget, WidgetQuery, WidgetType} from '../types';

type Props = {
  api: Client;
  children: (props: {
    errorMessage: undefined | string;
    loading: boolean;
    transformedResults: TableDataRow[];
    pageLinks?: null | string;
    totalCount?: string;
  }) => React.ReactNode;
  organization: OrganizationSummary;
  selection: PageFilters;
  widget: Widget;
  cursor?: string;
  limit?: number;
  onDataFetched?: (results: {
    issuesResults?: TableDataRow[];
    pageLinks?: string;
    totalIssuesCount?: string;
  }) => void;
};

type State = {
  errorMessage: undefined | string;
  loading: boolean;
  memberListStoreLoaded: boolean;
  pageLinks: null | string;
  tableResults: TableDataRow[];
  totalCount: null | string;
};

class IssueWidgetQueries extends Component<Props, State> {
  state: State = {
    loading: true,
    errorMessage: undefined,
    tableResults: [],
    memberListStoreLoaded: MemberListStore.isLoaded(),
    totalCount: null,
    pageLinks: null,
  };

  componentDidMount() {
    this.fetchData();
  }

  componentDidUpdate(prevProps: Props) {
    const {selection, widget, cursor} = this.props;
    // We do not fetch data whenever the query name changes.
    const [prevWidgetQueries] = prevProps.widget.queries.reduce(
      ([queries, names]: [Omit<WidgetQuery, 'name'>[], string[]], {name, ...rest}) => {
        queries.push(rest);
        names.push(name);
        return [queries, names];
      },
      [[], []]
    );

    const [widgetQueries] = widget.queries.reduce(
      ([queries, names]: [Omit<WidgetQuery, 'name'>[], string[]], {name, ...rest}) => {
        queries.push(rest);
        names.push(name);
        return [queries, names];
      },
      [[], []]
    );

    if (
      !isEqual(widget.displayType, prevProps.widget.displayType) ||
      !isEqual(widget.interval, prevProps.widget.interval) ||
      !isEqual(widgetQueries, prevWidgetQueries) ||
      !isSelectionEqual(selection, prevProps.selection) ||
      cursor !== prevProps.cursor
    ) {
      this.fetchData();
      return;
    }
  }

  componentWillUnmount() {
    this.unlisteners.forEach(unlistener => unlistener?.());
  }

  unlisteners = [
    MemberListStore.listen(() => {
      this.setState({
        memberListStoreLoaded: MemberListStore.isLoaded(),
      });
    }, undefined),
  ];

  config = getDatasetConfig(WidgetType.ISSUE);

  fetchData() {
    const {api, selection, widget, limit, cursor, organization, onDataFetched} =
      this.props;

    let totalCount, pageLinks, transformedResults;

    const apiPromises = this.config.getTableRequests!(widget, limit, cursor, {
      organization,
      pageFilters: selection,
      api,
    });

    try {
      this.setState({tableResults: [], loading: true, errorMessage: undefined});

      // TODO: Issues only has one promise, the transformed results
      // need to build in a sane way
      Promise.all(apiPromises).then(responses => {
        responses.forEach(([data, _, resp]) => {
          transformedResults = this.config.transformTable(data, widget.queries[0]);
          pageLinks = resp?.getResponseHeader('Link') ?? null; // <-- this is common

          // TODO: How to handle this unique stuff after making the request
          totalCount = resp?.getResponseHeader('X-Hits') ?? null; // <-- not in widgetQueries.tsx
        });
      });

      this.setState({
        loading: false,
        errorMessage: undefined,
        tableResults: transformedResults.data,
        totalCount,
        pageLinks,
      });
      onDataFetched?.({
        issuesResults: transformedResults.data,
        totalIssuesCount: totalCount ?? undefined,
        pageLinks: pageLinks ?? undefined,
      });
    } catch (response) {
      const errorResponse = response?.responseJSON?.detail ?? null;
      this.setState({
        loading: false,
        errorMessage: errorResponse ?? t('Unable to load Widget'),
        tableResults: [],
      });
    }
  }

  render() {
    const {children} = this.props;
    const {
      tableResults,
      loading,
      errorMessage,
      memberListStoreLoaded,
      pageLinks,
      totalCount,
    } = this.state;
    return getDynamicText({
      value: children({
        loading: loading || !memberListStoreLoaded,
        transformedResults: tableResults,
        errorMessage,
        pageLinks,
        totalCount: totalCount ?? undefined,
      }),
      fixed: <div />,
    });
  }
}

export default IssueWidgetQueries;
