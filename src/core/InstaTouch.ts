/* eslint-disable prefer-promise-reject-errors */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-throw-literal */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-async-promise-executor */
import rp, { OptionsWithUri } from 'request-promise';
import { Parser } from 'json2csv';
import { forEachLimit } from 'async';
import ora, { Ora } from 'ora';
import { tmpdir } from 'os';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { fromCallback } from 'bluebird';
import { writeFile, readFile, mkdir } from 'fs';

/**
 * Helper
 */
import { Downloader } from '.';

import { randomString } from '../helpers';

/**
 * Constant
 */
import CONST from '../constant';

/**
 * Types
 */
import {
    Constructor,
    User,
    Post,
    Hashtag,
    Location,
    Comments,
    PostCollector,
    PostMetaFromWebApi,
    GraphQlResponse,
    Result,
    Likers,
    UserMetaFromWebApi,
    Proxy,
    History,
    ScrapeType,
    Edges,
    GraphQl,
    UserStories,
    UserReelsFeed,
} from '../types';

export class InstaTouch {
    private url: string;

    private download: boolean;

    private filepath: string;

    private filetype: string;

    private fileName: string;

    private storeHistory: boolean;

    private input: string;

    private toCollect: number;

    private storeValue: string;

    private mediaType: string;

    private scrapeType: ScrapeType;

    private asyncDownload: number;

    private cli: boolean;

    private proxy: string[] | string;

    private session: string[] | string;

    private json2csvParser: Parser<any>;

    private collector: PostCollector[];

    private spinner: Ora;

    private userAgent: string;

    public Downloader: Downloader;

    private hasNextPage: boolean;

    private endCursor: string;

    private id: string;

    private timeout: number | undefined;

    private historyPath: string;

    private bulk: boolean;

    private zip: boolean;

    private itemCount: number;

    private csrfToken: string;

    private auth_error: boolean;

    private headers: {};

    constructor({
        url,
        download = false,
        filepath = '',
        filename = '',
        filetype,
        input,
        count,
        proxy,
        session,
        mediaType = 'all',
        scrapeType,
        asyncDownload,
        userAgent,
        progress = false,
        store_history = false,
        timeout,
        cli,
        endCursor,
        bulk = false,
        historyPath,
        zip = false,
        headers = {},
        user_id = false,
    }: Constructor) {
        this.zip = zip;
        this.url = url;
        this.id = user_id ? input : '';
        this.download = download;
        this.filepath = process.env.SCRAPING_FROM_DOCKER ? '/usr/app/files' : filepath || '';
        this.fileName = filename;
        this.filetype = filetype;
        this.storeValue = `${scrapeType}_${input}`;
        this.input = input;
        this.storeHistory = cli && store_history;
        this.toCollect = count;
        this.proxy = proxy;
        this.headers = headers;
        this.session = session;
        this.json2csvParser = new Parser({ flatten: true });
        this.mediaType = mediaType;
        this.scrapeType = scrapeType;
        this.asyncDownload = asyncDownload;
        this.collector = [];
        this.itemCount = 0;
        this.spinner = ora('InstaTouch Scraper Started');
        this.historyPath = process.env.SCRAPING_FROM_DOCKER ? '/usr/app/files' : historyPath || tmpdir();
        this.bulk = bulk;
        this.csrfToken = randomString(29);
        this.Downloader = new Downloader({
            progress,
            proxy,
            userAgent,
            filepath: process.env.SCRAPING_FROM_DOCKER ? '/usr/app/files' : filepath || '',
            bulk,
        });
        this.timeout = timeout;
        this.cli = cli;
        // Important!!! If you change user agents, hash keys will be invalid
        this.userAgent = userAgent || CONST.userAgent;
        this.hasNextPage = false;
        this.endCursor = endCursor as string;
        this.auth_error = false;
    }

    /**
     * Get proxy
     */
    private get getProxy(): Proxy {
        if (Array.isArray(this.proxy)) {
            const selectProxy = this.proxy.length ? this.proxy[Math.floor(Math.random() * this.proxy.length)] : '';
            return {
                socks: false,
                proxy: selectProxy,
            };
        }
        if (this.proxy.indexOf('socks4://') > -1 || this.proxy.indexOf('socks5://') > -1) {
            return {
                socks: true,
                proxy: new SocksProxyAgent(this.proxy as string),
            };
        }
        return {
            socks: false,
            proxy: this.proxy as string,
        };
    }

    /**
     * Get session id
     */
    private get getSession(): string {
        if (Array.isArray(this.session) && this.session.length) {
            return this.session[Math.floor(Math.random() * this.session.length)];
        }
        if (!Array.isArray(this.session) && this.session) {
            return this.session as string;
        }
        return '';
    }

    /**
     * Main request method
     * @param param0
     */
    private request<T>({ uri, method, qs, body, form, headers, json, gzip }: OptionsWithUri): Promise<T> {
        return new Promise(async (resolve, reject) => {
            const proxy = this.getProxy;
            const session = this.getSession;

            const options = {
                uri,
                method,
                ...(qs ? { qs } : {}),
                ...(body ? { body } : {}),
                ...(form ? { form } : {}),
                headers: {
                    'User-Agent': this.userAgent,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Upgrade-Insecure-Requests': 1,
                    ...(session ? { cookie: session } : {}),
                    ...headers,
                    ...this.headers,
                },
                ...(json ? { json: true } : {}),
                ...(gzip ? { gzip: true } : {}),
                resolveWithFullResponse: true,
                ...(proxy.proxy && proxy.socks ? { agent: proxy.proxy } : {}),
                ...(proxy.proxy && !proxy.socks ? { proxy: `http://${proxy.proxy}/` } : {}),
            } as OptionsWithUri;

            try {
                const response = await rp(options);
                if (response.headers['content-type'].indexOf('text/html') > -1) {
                    if (response.body.indexOf('AuthLogin') > -1) {
                        this.auth_error = true;
                    }
                    throw new Error(`Wrong response content type! Received: ${response.headers['content-type']} Expected: application/json`);
                }

                if (this.timeout) {
                    setTimeout(() => {
                        resolve(response.body);
                    }, this.timeout);
                } else {
                    resolve(response.body);
                }
            } catch (error) {
                if (error.name === 'StatusCodeError') {
                    if (error.response.headers['content-type'].indexOf('application/json') > -1) {
                        if (error.response.body.status === 'fail') {
                            this.auth_error = true;
                        }
                    }
                    reject(`Can't find requested data`);
                } else if (error.name === 'RequestError') {
                    reject(`Request error`);
                } else {
                    reject(error);
                }
            }
        });
    }

    private returnInitError(error) {
        if (this.cli && !this.bulk) {
            this.spinner.stop();
        }
        throw error;
    }

    /**
     * Get folder destination, where all downloaded posts will be saved
     */
    private get folderDestination(): string {
        switch (this.scrapeType) {
            case 'user':
                return this.filepath ? `${this.filepath}/${this.input}` : this.input;
            case 'hashtag':
                return this.filepath ? `${this.filepath}/#${this.input}` : `#${this.input}`;
            case 'location':
                return this.filepath ? `${this.filepath}/location:${this.input}` : `location:${this.input}`;
            default:
                throw new TypeError(`${this.scrapeType} is not supported`);
        }
    }

    /**
     * Starting point
     */
    public async startScraper(): Promise<Result | any> {
        if (this.cli && !this.bulk) {
            this.spinner.start();
        }

        if (this.download && !this.zip) {
            try {
                await fromCallback((cb) => mkdir(this.folderDestination, { recursive: true }, cb));
            } catch (error) {
                return this.returnInitError(error.message);
            }
        }
        if (!this.scrapeType || CONST.scrapeType.indexOf(this.scrapeType) === -1) {
            return this.returnInitError(`Missing scraping type. Scrape types: ${CONST.scrapeType} `);
        }
        if (!this.input) {
            return this.returnInitError('Missing input');
        }

        if (CONST.startFromWebPage.indexOf(this.scrapeType) > -1) {
            try {
                await this.extractData();
            } catch {
                //
            }
        }

        if (CONST.startFromWebApi.indexOf(this.scrapeType) > -1) {
            try {
                if (!this.id) {
                    const user = await this.getUserMeta(this.url);
                    this.id = user.graphql.user.id;
                }
            } catch {
                //
            }
        }

        if (!this.auth_error) {
            if (this.collector.length < this.toCollect) {
                await this.mainLoop();
            }

            if (this.storeHistory) {
                await this.storeDownlodProgress();
            }
        }
        const [json, csv] = await this.saveCollectorData();

        return {
            count: this.itemCount,
            has_more: this.hasNextPage,
            end_cursor: this.endCursor,
            id: this.id,
            collector: this.collector,
            ...(this.filetype === 'all' ? { json, csv } : {}),
            ...(this.filetype === 'json' ? { json } : {}),
            ...(this.filetype === 'csv' ? { csv } : {}),
            auth_error: this.auth_error,
        };
    }

    /**
     * Get file destination(csv, zip, json)
     */
    private get fileDestination(): string {
        if (this.fileName) {
            return this.filepath ? `${this.filepath}/${this.fileName}` : this.fileName;
        }
        switch (this.scrapeType) {
            case 'user':
            case 'hashtag':
            case 'location':
                return this.filepath ? `${this.filepath}/${this.input}_${Date.now()}` : `${this.input}_${Date.now()}`;
            default:
                return this.filepath ? `${this.filepath}/${this.scrapeType}_${Date.now()}` : `${this.scrapeType}_${Date.now()}`;
        }
    }

    /**
     * Store collector data in the CSV and/or JSON files
     */
    private async saveCollectorData(): Promise<string[]> {
        if (this.download) {
            if (this.cli) {
                this.spinner.stop();
            }
            if (this.collector.length) {
                await this.Downloader.downloadPosts({
                    zip: this.zip,
                    folder: this.folderDestination,
                    collector: this.collector,
                    fileName: this.fileDestination,
                    asyncDownload: this.asyncDownload,
                });
            }
        }
        let json = '';
        let csv = '';

        if (this.collector.length) {
            json = `${this.fileDestination}.json`;
            csv = `${this.fileDestination}.csv`;

            if (this.collector.length) {
                switch (this.filetype) {
                    case 'json':
                        await fromCallback((cb) => writeFile(json, JSON.stringify(this.collector), cb));
                        break;
                    case 'csv':
                        await fromCallback((cb) => writeFile(csv, this.json2csvParser.parse(this.collector), cb));
                        break;
                    case 'all':
                        await Promise.all([
                            await fromCallback((cb) => writeFile(json, JSON.stringify(this.collector), cb)),
                            await fromCallback((cb) => writeFile(csv, this.json2csvParser.parse(this.collector), cb)),
                        ]);
                        break;
                    default:
                        break;
                }
            }
        }
        if (this.cli) {
            this.spinner.stop();
        }
        return [json, csv];
    }

    /**
     * Main loop that collects all required metadata from the ig web api
     */
    private async mainLoop(): Promise<any> {
        while (true) {
            try {
                /**
                 * If {bulk} === false and {collector} already has items in it
                 * then we need to end the process
                 */
                if (!this.bulk && this.collector.length) {
                    break;
                }
                await this.graphQlRequest();
                if (!this.bulk) {
                    break;
                }
            } catch (error) {
                break;
            }
        }
    }

    private async graphQlRequest() {
        const options = {
            method: 'GET',
            uri: 'https://www.instagram.com/graphql/query/',
            json: true,
            gzip: true,
            qs: {
                query_hash: CONST.hash[this.scrapeType],
                variables: this.grapQlQuery,
            },
            headers: {
                Accept: '*/*',
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest',
            },
            timeout: 5000,
        };

        let graphData = {} as Edges;
        try {
            switch (this.scrapeType) {
                case 'user': {
                    const result = await this.request<GraphQlResponse<User>>(options);
                    this.hasNextPage = result.data.user.edge_owner_to_timeline_media.page_info.has_next_page;
                    this.endCursor = result.data.user.edge_owner_to_timeline_media.page_info.end_cursor;
                    graphData = result.data.user.edge_owner_to_timeline_media;
                    break;
                }
                case 'followers': {
                    const result = await this.request<GraphQlResponse<User>>(options);
                    this.hasNextPage = result.data.user.edge_followed_by.page_info.has_next_page;
                    this.endCursor = result.data.user.edge_followed_by.page_info.end_cursor;
                    graphData = result.data.user.edge_followed_by;
                    break;
                }
                case 'following': {
                    const result = await this.request<GraphQlResponse<User>>(options);
                    this.hasNextPage = result.data.user.edge_follow.page_info.has_next_page;
                    this.endCursor = result.data.user.edge_follow.page_info.end_cursor;
                    graphData = result.data.user.edge_follow;
                    break;
                }
                case 'hashtag': {
                    const result = await this.request<GraphQlResponse<Hashtag>>(options);
                    this.hasNextPage = result.data.hashtag.edge_hashtag_to_media.page_info.has_next_page;
                    this.endCursor = result.data.hashtag.edge_hashtag_to_media.page_info.end_cursor;
                    graphData = result.data.hashtag.edge_hashtag_to_media;
                    break;
                }
                case 'location': {
                    const result = await this.request<GraphQlResponse<Location>>(options);
                    this.hasNextPage = result.data.location.edge_location_to_media.page_info.has_next_page;
                    this.endCursor = result.data.location.edge_location_to_media.page_info.end_cursor;
                    graphData = result.data.location.edge_location_to_media;
                    break;
                }
                case 'comments': {
                    const result = await this.request<GraphQlResponse<Comments>>(options);
                    this.hasNextPage = result.data.shortcode_media.edge_media_to_parent_comment.page_info.has_next_page;
                    this.endCursor = result.data.shortcode_media.edge_media_to_parent_comment.page_info.end_cursor;
                    graphData = result.data.shortcode_media.edge_media_to_parent_comment;
                    break;
                }
                case 'likers': {
                    const result = await this.request<GraphQlResponse<Likers>>(options);
                    this.hasNextPage = result.data.shortcode_media.edge_liked_by.page_info.has_next_page;
                    this.endCursor = result.data.shortcode_media.edge_liked_by.page_info.end_cursor;
                    graphData = result.data.shortcode_media.edge_liked_by;
                    break;
                }
                default:
                    break;
            }
            this.itemCount = graphData.count;

            await this.collectPosts(graphData.edges);

            if (this.collector.length >= this.toCollect) {
                throw new Error('Done');
            }
            if (!this.hasNextPage) {
                throw new Error('No more posts');
            }
        } catch (error) {
            throw error.message;
        }
    }

    private get grapQlQuery() {
        switch (this.scrapeType) {
            case 'user':
                return JSON.stringify({ id: this.id, first: this.bulk ? 50 : this.toCollect, after: this.endCursor });
            case 'hashtag':
                return JSON.stringify({ tag_name: this.input, show_ranked: false, first: this.bulk ? 50 : this.toCollect, after: this.endCursor });
            case 'location':
                return JSON.stringify({ id: this.input, first: this.bulk ? 50 : this.toCollect, after: this.endCursor });
            case 'comments':
                return JSON.stringify({ shortcode: this.input, first: this.bulk ? 50 : this.toCollect, after: this.endCursor });
            case 'likers':
                return JSON.stringify({
                    shortcode: this.input,
                    include_reel: true,
                    first: this.bulk ? 50 : this.toCollect,
                    after: this.endCursor,
                });
            case 'followers':
            case 'following':
                return JSON.stringify({
                    id: this.id,
                    include_reel: true,
                    fetch_mutual: false,
                    first: this.bulk ? 50 : this.toCollect,
                    after: this.endCursor,
                });
            default:
                return '';
        }
    }

    private async extractDataHelper(edges: Post[], count: number) {
        if (edges.length > this.toCollect) {
            edges.splice(this.toCollect);
        }

        if (this.toCollect > count) {
            this.toCollect = count;
        }
        this.itemCount = count;
        if (!this.endCursor) {
            await this.collectPosts(edges);
        }
    }

    /**
     * In order to start scraping user, hashtag, location and comments
     * We need to extract ID's that are required to send graphQL request
     */
    private async extractData(): Promise<any> {
        switch (this.scrapeType) {
            case 'user': {
                if (!this.id) {
                    const result = await this.extractJson<User>();
                    try {
                        this.id = result.graphql.user.id;
                    } catch (error) {
                        throw new Error(`Can't scrape date. Please try again or submit issue to the github`);
                    }
                }
                break;
            }
            case 'hashtag': {
                if (!this.endCursor) {
                    const result = await this.extractJson<Hashtag>();
                    try {
                        const { edges, count } = result.graphql.hashtag.edge_hashtag_to_media;
                        this.id = result.graphql.hashtag.name;
                        this.hasNextPage = result.graphql.hashtag.edge_hashtag_to_media.page_info.has_next_page;
                        await this.extractDataHelper(edges, count);
                        this.endCursor = this.endCursor || result.graphql.hashtag.edge_hashtag_to_media.page_info.end_cursor;
                    } catch (error) {
                        throw new Error(`Can't scrape date. Please try again or submit issue to the github`);
                    }
                }
                break;
            }
            case 'location': {
                break;
            }
            case 'comments': {
                const result = await this.extractJson<Comments>();
                try {
                    const { edges, count } = result.graphql.shortcode_media.edge_media_to_parent_comment;
                    this.id = result.graphql.shortcode_media.shortcode;
                    this.hasNextPage = result.graphql.shortcode_media.edge_media_to_parent_comment.page_info.has_next_page;
                    await this.extractDataHelper(edges, count);
                    this.endCursor = this.endCursor || result.graphql.shortcode_media.edge_media_to_parent_comment.page_info.end_cursor;
                } catch (error) {
                    throw new Error(`Can't scrape date. Please try again or submit issue to the github`);
                }
                break;
            }
            default:
                throw new Error(`Not supported type here: ${this.scrapeType}`);
        }
    }

    /**
     * Extract csrf token
     */
    private async extractJson<T>(): Promise<GraphQl<T>> {
        const options = {
            method: 'GET',
            gzip: true,
            jar: true,
            uri: this.url,
            headers: {
                Accept: 'application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'en-US,en;q=0.5',
                'Upgrade-Insecure-Requests': 1,
            },
            json: true,
        };

        const response = await this.request<GraphQl<T>>(options);

        return response;
    }

    /**
     * Get user reels feed
     * @param target_user_id
     * @param page_size
     * @param max_id
     * @returns
     */
    public async getUserReels(target_user_id: string, page_size: number, max_id: string): Promise<UserReelsFeed> {
        const options = {
            method: 'POST',
            uri: `https://i.instagram.com/api/v1/clips/user/`,
            form: {
                target_user_id,
                page_size,
                max_id,
            },
            headers: {
                'X-CSRFToken': this.csrfToken,
                'X-IG-App-ID': '936619743392459',
            },
            gzip: true,
            json: true,
        };

        const response = await this.request<UserReelsFeed>(options);
        return response;
    }

    /**
     * Get post metadata
     * @param uri
     * @returns
     */
    public async getPostMeta(uri: string): Promise<PostMetaFromWebApi> {
        const options = {
            method: 'GET',
            uri,
            gzip: true,
            json: true,
        };

        const response = await this.request<PostMetaFromWebApi>(options);
        return response;
    }

    /**
     * Get user stories
     * @param id
     * @returns
     */
    public async getStories(id: string): Promise<UserStories> {
        const options = {
            method: 'GET',
            uri: `https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=${id}`,
            headers: {
                'X-IG-App-ID': '936619743392459',
            },
            gzip: true,
            json: true,
        };

        const response = await this.request<UserStories>(options);
        return response;
    }

    /**
     * Get user metadata
     * @param uri
     * @returns
     */
    public async getUserMeta(uri: string): Promise<UserMetaFromWebApi> {
        const options = {
            method: 'GET',
            uri,
            gzip: true,
            json: true,
        };

        const response = await this.request<UserMetaFromWebApi>(options);
        return response;
    }

    private collectPosts(edges: Post[]): Promise<any> {
        return new Promise((resolve) => {
            forEachLimit(
                edges,
                5,
                (post, cb) => {
                    switch (this.scrapeType) {
                        case 'user':
                        case 'hashtag':
                        case 'location': {
                            const description = post.node.edge_media_to_caption.edges.length
                                ? post.node.edge_media_to_caption.edges[0].node.text
                                : '';
                            const hashtags = description.match(/(#\w+)/g);
                            const mentions = description.match(/(@\w+)/g);
                            const item: PostCollector = {
                                id: post.node.id,
                                shortcode: post.node.shortcode,
                                type: post.node.__typename,
                                is_video: post.node.is_video,
                                ...(post.node.is_video ? { video_url: post.node.video_url } : {}),
                                dimension: post.node.dimensions,
                                display_url: post.node.display_url,
                                thumbnail_src: post.node.thumbnail_src,
                                owner: post.node.owner,
                                description,
                                comments: post.node.edge_media_to_comment.count,
                                likes: post.node.edge_media_preview_like.count,
                                ...(post.node.is_video ? { views: post.node.video_view_count } : {}),
                                comments_disabled: post.node.comments_disabled,
                                taken_at_timestamp: post.node.taken_at_timestamp,
                                location: post.node.location,
                                hashtags: hashtags || [],
                                mentions: mentions || [],
                                ...(this.scrapeType === 'user'
                                    ? {
                                          tagged_users: post.node.edge_media_to_tagged_user.edges.length
                                              ? post.node.edge_media_to_tagged_user.edges.map((taggedUser) => {
                                                    return {
                                                        user: {
                                                            full_name: taggedUser.node.user.full_name,
                                                            id: taggedUser.node.user.id,
                                                            is_verified: taggedUser.node.user.is_verified,
                                                            profile_pic_url: taggedUser.node.user.profile_pic_url,
                                                            username: taggedUser.node.user.username,
                                                        },
                                                        x: taggedUser.node.x,
                                                        y: taggedUser.node.y,
                                                    };
                                                })
                                              : [],
                                      }
                                    : {}),
                            };

                            this.cbCollector(cb, item);

                            break;
                        }
                        case 'comments': {
                            const item: PostCollector = {
                                id: post.node.id,
                                text: post.node.text,
                                created_at: post.node.created_at,
                                did_report_as_spam: post.node.did_report_as_spam,
                                owner: post.node.owner,
                                likes: post.node.edge_liked_by.count,
                                comments: post.node.edge_threaded_comments.count,
                            };

                            this.cbCollector(cb, item);
                            break;
                        }
                        case 'likers':
                        case 'followers':
                        case 'following': {
                            const item: PostCollector = {
                                id: post.node.id,
                                username: post.node.username,
                                full_name: post.node.full_name,
                                profile_pic_url: post.node.profile_pic_url,
                                is_private: post.node.is_private,
                                is_verified: post.node.is_verified,
                            };

                            this.cbCollector(cb, item);
                            break;
                        }
                        default:
                            break;
                    }
                },
                () => {
                    resolve('');
                },
            );
        });
    }

    /**
     * Collectors callback method
     * @param cb
     * @param item
     */
    private cbCollector(cb, item: PostCollector): any {
        if (item.is_video && this.mediaType === 'image') {
            cb(null);
        } else if (this.mediaType === 'video' && !item.is_video) {
            cb(null);
        } else {
            this.collector.push(item);
            cb(null);
        }
    }

    /**
     * Store progress to avoid downloading duplicates
     * Only available from the CLI
     */
    private async storeDownlodProgress() {
        const historyType = `${this.scrapeType}_${this.input}`;
        if (this.storeValue) {
            let history = {} as History;

            try {
                const readFromStore = (await fromCallback((cb) =>
                    readFile(`${this.historyPath}/ig_history.json`, { encoding: 'utf-8' }, cb),
                )) as string;
                history = JSON.parse(readFromStore);
            } catch (error) {
                history[historyType] = {
                    type: this.scrapeType,
                    input: this.input,
                    collected_items: 0,
                    last_change: new Date(),
                    file_location: `${this.historyPath}/ig_${this.storeValue}.json`,
                };
            }

            if (!history[historyType]) {
                history[historyType] = {
                    type: this.scrapeType,
                    input: this.input,
                    collected_items: 0,
                    last_change: new Date(),
                    file_location: `${this.historyPath}/ig_${this.storeValue}.json`,
                };
            }
            let store: string[];
            try {
                const readFromStore = (await fromCallback((cb) =>
                    readFile(`${this.historyPath}/ig_${this.storeValue}.json`, { encoding: 'utf-8' }, cb),
                )) as string;
                store = JSON.parse(readFromStore);
            } catch (error) {
                store = [];
            }

            this.collector = this.collector.map((item) => {
                if (store.indexOf(item.id) === -1) {
                    store.push(item.id);
                } else {
                    // eslint-disable-next-line no-param-reassign
                    item.repeated = true;
                }
                return item;
            });
            this.collector = this.collector.filter((item) => !item.repeated);

            history[historyType] = {
                type: this.scrapeType,
                input: this.input,
                collected_items: history[historyType].collected_items + this.collector.length,
                last_change: new Date(),
                file_location: `${this.historyPath}/ig_${this.storeValue}.json`,
            };

            try {
                await fromCallback((cb) => writeFile(`${this.historyPath}/ig_${this.storeValue}.json`, JSON.stringify(store), cb));
            } catch (error) {
                // continue regardless of error
            }

            try {
                await fromCallback((cb) => writeFile(`${this.historyPath}/ig_history.json`, JSON.stringify(history), cb));
            } catch (error) {
                // continue regardless of error
            }
        }
    }
}
