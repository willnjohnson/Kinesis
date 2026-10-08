import { useEffect, useMemo, useState } from 'react';
import type { ElementType, RefObject } from 'react';
import { Pencil, X, Globe, FileText, BadgeCheck, CaseSensitive } from 'lucide-react';
import { UnderlineTabs } from './ui/UnderlineTabs';
import { BsTwitterX, BsInstagram, BsFacebook, BsYoutube, BsTiktok, BsThreads, BsTwitch, BsReddit, BsDiscord } from 'react-icons/bs';
import { SiWikipedia } from 'react-icons/si';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkHighlight } from '../lib/remark-highlight';
import { remarkTimestamps } from '../lib/remark-timestamps';
import { remarkEmbeds } from '../lib/remark-embeds';
import { foldVideoLinkTimes, markdownUrlTransform } from '../lib/internal-links';
import { MarkdownLink } from './MarkdownLink';
import { BacklinksList } from './BacklinksList';
import { useBioPreview } from './GlossaryPreview';
import { AlphabetJumpNav } from './AlphabetJumpNav';
import { BIOGRAPHY_CHANGED_EVENT, getBiographyDrives, checkChannelIdentity, getBiography, renameBiographyDisplayName, setBiographyHandleCase, getBiographies, updateBiography, type BiographyEntry, fetchChannelVideosV3, getHandleDrives, type HandleDrive, type Video } from '../api';
import { openExternalUrlGuarded } from '../lib/external-links';
import { useFlags } from '../hooks/useFlags';
import { useWorkspace } from '../hooks/useWorkspace';
import { normalizeText, driveSegmentLabel } from '../lib/utils';
import { useCloseOnNavigate } from '../lib/navigation';
import { handlePlainContextMenu } from '../lib/markdown-editor';
import { MarkdownField } from './MarkdownField';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import { useSelectableText, SELECTABLE_CLASS } from '../hooks/useSelectableText';
import { SecondaryButton } from './ui/Button';
import { AliasBadge } from './ui/AliasBadge';
import { Modal } from './Modal';
import { useAliasOnly, useShowAlias } from '../hooks/useBioAlias';
import { backdropProps } from '../lib/backdrop';

type EditableBiography = BiographyEntry | null;

/** A handle without its "@", lowercased: two handles that only differ in capitals compare equal. */
const handleKey = (h: string) => h.trim().replace(/^@/, '').toLowerCase();

/** Why the Handle tab's text can't be saved, or null when it can: only its capitals may differ from the stored handle. */
function handleCaseError(stored: string, typed: string): string | null {
    if (!typed.trim().replace(/^@/, '')) return "Type the channel's handle.";
    if (handleKey(typed) !== handleKey(stored)) return `Only the capitals can change: it has to stay ${stored}.`;
    return null;
}

/** Channels being checked against YouTube right now (BiographyModal), so the same one isn't asked twice at once. */
const identityChecking = new Set<string>();
type SocialTab = 'wikipedia' | 'website' | 'twitter' | 'instagram' | 'facebook' | 'threads' | 'youtube' | 'tiktok' | 'twitch' | 'reddit' | 'discord';
type SocialKey = 'wikipedia' | 'website' | 'twitter' | 'instagram' | 'facebook' | 'threads' | 'youtube' | 'tiktok' | 'twitch' | 'reddit' | 'discord';

const socialConfig: Record<SocialKey, { icon: ElementType; label: string }> = {
    website: { icon: Globe, label: 'Website' },
    wikipedia: { icon: SiWikipedia, label: 'Wikipedia' },
    twitter: { icon: BsTwitterX, label: 'X' },
    instagram: { icon: BsInstagram, label: 'Instagram' },
    facebook: { icon: BsFacebook, label: 'Facebook' },
    threads: { icon: BsThreads, label: 'Threads' },
    youtube: { icon: BsYoutube, label: 'YouTube' },
    tiktok: { icon: BsTiktok, label: 'TikTok' },
    twitch: { icon: BsTwitch, label: 'Twitch' },
    reddit: { icon: BsReddit, label: 'Reddit' },
    discord: { icon: BsDiscord, label: 'Discord' },
};

const socialOrder: SocialKey[] = ['website', 'wikipedia', 'twitter', 'instagram', 'facebook', 'threads', 'youtube', 'tiktok', 'twitch', 'reddit', 'discord'];

const getSocialValue = (bio: BiographyEntry, key: SocialKey): string => {
    return bio[key]?.trim() || '';
};

const socialTabConfig: Record<SocialTab, { icon: ElementType; label: string; placeholder: string; fullUrl: boolean }> = {
    website: { icon: Globe, label: 'Website', placeholder: 'https://example.com', fullUrl: true },
    wikipedia: { icon: SiWikipedia, label: 'Wikipedia', placeholder: 'https://wikipedia.org/...', fullUrl: true },
    twitter: { icon: BsTwitterX, label: 'X', placeholder: 'username', fullUrl: false },
    instagram: { icon: BsInstagram, label: 'Instagram', placeholder: 'username', fullUrl: false },
    facebook: { icon: BsFacebook, label: 'Facebook', placeholder: 'username or page', fullUrl: false },
    threads: { icon: BsThreads, label: 'Threads', placeholder: 'username', fullUrl: false },
    youtube: { icon: BsYoutube, label: 'YouTube', placeholder: '@handle or channel ID', fullUrl: false },
    tiktok: { icon: BsTiktok, label: 'TikTok', placeholder: '@username', fullUrl: false },
    twitch: { icon: BsTwitch, label: 'Twitch', placeholder: 'username', fullUrl: false },
    reddit: { icon: BsReddit, label: 'Reddit', placeholder: 'r/subreddit', fullUrl: false },
    discord: { icon: BsDiscord, label: 'Discord', placeholder: 'server invite', fullUrl: false },
};

const socialTabs: SocialTab[] = ['website', 'wikipedia', 'twitter', 'instagram', 'facebook', 'threads', 'youtube', 'tiktok', 'twitch', 'reddit', 'discord'];

const normalizeSocialValue = (key: SocialTab, value: string): string => {
    if (!value) return '';
    if (key === 'website' || key === 'wikipedia') {
        return value.startsWith('http') ? value : `https://${value}`;
    } else {
        // If value is already a full URL, return as-is
        if (value.startsWith('http://') || value.startsWith('https://')) {
            return value;
        }
        // Platform handles: strip leading @ and build full URL
        const handle = value.startsWith('@') ? value.slice(1) : value;
        const prefixes: Record<SocialTab, string> = {
            twitter: 'https://twitter.com/',
            instagram: 'https://instagram.com/',
            facebook: 'https://facebook.com/',
            threads: 'https://threads.net/@',
            youtube: 'https://youtube.com/@',
            tiktok: 'https://tiktok.com/@',
            twitch: 'https://twitch.tv/',
            reddit: 'https://reddit.com/',
            discord: 'https://discord.gg/',
            website: '',
            wikipedia: '',
        };
        return prefixes[key] + handle;
    }
};

/** A social a line of pasted bio text can be auto-detected as, e.g. "Instagram: @handle" or
 *  "Twitter: https://x.com/handle". "X" is an alias for the same `twitter` field the UI already
 *  labels "X". youtube/reddit/discord aren't offered here — no line-prefix convention was given
 *  for them and the existing socials UI already covers adding them by hand. */
type DetectableSocial = 'twitter' | 'instagram' | 'facebook' | 'wikipedia' | 'threads' | 'tiktok' | 'twitch' | 'website';

const DETECTABLE_LABELS: Record<string, DetectableSocial> = {
    x: 'twitter',
    twitter: 'twitter',
    instagram: 'instagram',
    facebook: 'facebook',
    wikipedia: 'wikipedia',
    threads: 'threads',
    tiktok: 'tiktok',
    twitch: 'twitch',
    website: 'website',
};

// A URL only counts as a match when it's on the platform's own domain AND has a path beyond the
// bare domain (e.g. x.com/handle, not just x.com) — a naked domain isn't a link to anyone.
const PLATFORM_URL_PATTERNS: Partial<Record<DetectableSocial, RegExp>> = {
    twitter: /^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)\/\S+/i,
    instagram: /^(https?:\/\/)?(www\.)?instagram\.com\/\S+/i,
    facebook: /^(https?:\/\/)?(www\.)?facebook\.com\/\S+/i,
    wikipedia: /^(https?:\/\/)?([a-z0-9-]+\.)?wikipedia\.org\/\S+/i,
    threads: /^(https?:\/\/)?(www\.)?threads\.(net|com)\/\S+/i,
    tiktok: /^(https?:\/\/)?(www\.)?tiktok\.com\/\S+/i,
    twitch: /^(https?:\/\/)?(www\.)?twitch\.tv\/\S+/i,
};

// Facebook and Wikipedia only make sense as a link (no bare "@handle" convention for either);
// the rest also accept a plain handle or @handle.
const URL_ONLY: ReadonlySet<DetectableSocial> = new Set(['facebook', 'wikipedia']);
const HANDLE_PATTERN = /^@?[A-Za-z0-9._-]{1,30}$/;
const WEBSITE_PATTERN = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

// A pasted description links a social with actual markdown, not a bare URL — "[Site.com](https://
// site.com/)" or "<https://site.com/>" rather than plain text. Unwrap those down to the URL itself
// before matching a platform's domain, or a real link would look like it failed the domain check.
const extractLinkTarget = (value: string): string => {
    const trimmed = value.trim();
    const mdLink = trimmed.match(/^\[[^\]]*\]\((\S+?)\)$/);
    if (mdLink) return mdLink[1];
    const autoLink = trimmed.match(/^<(\S+?)>$/);
    if (autoLink) return autoLink[1];
    return trimmed;
};

/** Validates `value` for `platform`, returning the piece to normalize/pin, or null if it doesn't
 *  look like a real handle/link for that platform. */
const matchSocialValue = (platform: DetectableSocial, value: string): string | null => {
    const trimmed = extractLinkTarget(value);
    if (!trimmed) return null;
    const urlPattern = PLATFORM_URL_PATTERNS[platform];
    if (urlPattern && urlPattern.test(trimmed)) return trimmed;
    if (platform === 'website') return WEBSITE_PATTERN.test(trimmed) ? trimmed : null;
    if (URL_ONLY.has(platform)) return null;
    return HANDLE_PATTERN.test(trimmed) ? trimmed : null;
};

interface DetectedSocial {
    platform: DetectableSocial;
    normalized: string;
}

/** Scans pasted/typed bio text for "Label: value" lines and returns the socials worth offering to
 *  pin — one per platform (first match wins), skipping anything that already matches what's
 *  already saved for that platform. */
const detectSocialCandidates = (bio: string, current: BiographyEntry): DetectedSocial[] => {
    const seen = new Set<DetectableSocial>();
    const candidates: DetectedSocial[] = [];
    for (const rawLine of bio.split('\n')) {
        const match = rawLine.trim().match(/^([A-Za-z]+)\s*:\s*(.+)$/);
        if (!match) continue;
        const platform = DETECTABLE_LABELS[match[1].toLowerCase()];
        if (!platform || seen.has(platform)) continue;
        const value = matchSocialValue(platform, match[2]);
        if (!value) continue;
        const normalized = normalizeSocialValue(platform, value);
        if ((current[platform] || '').trim() === normalized) continue;
        seen.add(platform);
        candidates.push({ platform, normalized });
    }
    return candidates;
};

/** A small on/off switch in the status bar's own size (Settings' Toggle is too tall for it): a label, then the switch. */
function BarSwitch({ label, on, onChange, title, disabled = false }: { label: string; on: boolean; onChange: (on: boolean) => void; title: string; disabled?: boolean }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(!on)}
            title={title}
            className="shrink-0 flex items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5 text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-gray-400"
        >
            {label}
            <span className={`relative w-6 h-3.5 rounded-full transition-colors ${on && !disabled ? 'bg-red-600' : 'bg-[#3a3a3a]'}`}>
                <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${on ? 'left-3' : 'left-0.5'}`} />
            </span>
        </button>
    );
}

/** A person's name in the list. While the pointer is on the name itself, their description, if they have one, is previewed.
 *  It's only as wide as the name, so the row's edit icon sits right after the text. The button (not a wrapping element
 *  outside it) is what opens the biography — the preview
 *  card is portaled elsewhere on the page, but React still bubbles a click on it up through this component's own JSX tree;
 *  keeping that tree flat (the card is this button's sibling, not its child) is what stops a click on the card's Copy or
 *  Open button from also re-triggering this one. */
function PersonName({ person, showAlias, aliasOnly, onOpen }: { person: BiographyEntry; showAlias: boolean; aliasOnly: boolean; onOpen: () => void }) {
    const preview = useBioPreview(person, onOpen);
    const alias = showAlias ? person.alias.trim() : '';
    // Alias Only: the alias stands in for the channel's own name (its handle stays, to tell channels apart).
    if (alias && aliasOnly) {
        return (
            <>
                <button onClick={onOpen} className="min-w-0 text-left cursor-pointer">
                    <span {...preview.handlers} className="text-base group-hover:text-[var(--k-accent)] transition-colors">
                        <AliasBadge alias={alias} displayName={person.displayName || person.handle} />
                    </span>
                    <span className="ml-1.5 text-xs text-gray-500">({person.handle})</span>
                </button>
                {preview.card}
            </>
        );
    }
    return (
        <>
            <button onClick={onOpen} className="min-w-0 text-left cursor-pointer">
                {/* The alias (Edit Bio), when there is one: marked before the channel's own name. */}
                {alias && <AliasBadge alias={alias} displayName={person.displayName || person.handle} className="mr-1.5" />}
                <span {...preview.handlers} className="group-hover:underline group-hover:decoration-dotted group-hover:underline-offset-4 group-hover:text-[var(--k-accent)] transition-all text-base font-medium">
                    {person.displayName || person.handle}
                </span>
                <span className="ml-1.5 text-xs text-gray-500">({person.handle})</span>
            </button>
            {preview.card}
        </>
    );
}

export function BiographyView({ searchQuery, onChange, onVideoSelect, onViewMore, onDriveSelect, allowEditBio, scrollContainerRef }: { searchQuery: string; onChange?: () => void; onVideoSelect?: (video: Video) => void; onViewMore?: (handle: string) => void; onDriveSelect?: (path: string, label: string) => void; allowEditBio?: boolean; scrollContainerRef: RefObject<HTMLDivElement | null> }) {
    const { labels } = useWorkspace();
    const [entries, setEntries] = useState<BiographyEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<BiographyEntry | null>(null);
    // Closes when the app goes somewhere else (its "See more" search, a Drive, a link: lib/navigation.ts).
    useCloseOnNavigate(selected !== null, () => setSelected(null));
    const [editing, setEditing] = useState<EditableBiography>(null);
    // The entry as it was when the edit began, for telling whether anything's changed.
    const [editingOriginal, setEditingOriginal] = useState<EditableBiography>(null);
    const [activeSocialTab, setActiveSocialTab] = useState<SocialTab>('website');
    const [pendingSocialPins, setPendingSocialPins] = useState<DetectedSocial[] | null>(null);
    const [confirmClose, setConfirmClose] = useState(false);
    // Show Alias (the status bar's toggle): aliases show as badges, and the list goes by a channel's alias where it has
    // one. Off, it's the channels' own names, in their order.
    const [showAlias, setShowAlias] = useShowAlias();
    const [aliasOnly, setAliasOnly] = useAliasOnly();
    const nameOf = (p: BiographyEntry) => (showAlias && p.alias.trim()) || p.displayName.trim() || p.handle;

    // The window's Alias and Handle tabs, and the Handle tab's text (the stored handle until the capitals are changed).
    const [nameTab, setNameTab] = useState<'alias' | 'handle'>('alias');
    const [handleDraft, setHandleDraft] = useState('');
    const [handleSaveError, setHandleSaveError] = useState<string | null>(null);

    const startEdit = (person: BiographyEntry) => {
        setEditing(person);
        setEditingOriginal(person);
        setActiveSocialTab('website');
        setNameTab('alias');
        setHandleDraft(person.handle);
        setHandleSaveError(null);
    };

    const closeEdit = () => {
        setEditing(null);
        setEditingOriginal(null);
        setPendingSocialPins(null);
    };

    const handleError = editing ? handleCaseError(editing.handle, handleDraft) : null;
    // Typed without its "@" counts as the same handle: the "@" is kept as stored.
    const handleChanged = editing !== null && !handleError && handleDraft.trim().replace(/^@/, '') !== editing.handle.replace(/^@/, '');
    const editHasChanges = editing !== null && editingOriginal !== null && (
        handleChanged
        || (editing.bio || '') !== (editingOriginal.bio || '')
        || (editing.alias || '').trim() !== (editingOriginal.alias || '').trim()
        || socialTabs.some(key => (editing[key] || '') !== (editingOriginal[key] || ''))
    );

    // Backdrop click, Esc and the X ask first when there's something unsaved; Cancel discards on purpose.
    const requestCloseEdit = () => { if (editHasChanges) setConfirmClose(true); else closeEdit(); };

    const loadEntries = async () => {
        try {
            const rows = await getBiographies();
            // Deduplicate entries based on handle (case-insensitive)
            const uniqueRows = new Map<string, BiographyEntry>();
            rows.forEach(row => {
                const key = row.handle.toLowerCase();
                if (!uniqueRows.has(key)) {
                    uniqueRows.set(key, row);
                }
            });
            setEntries(Array.from(uniqueRows.values()));
        } catch (error) {
            console.error('Failed to load biographies:', error);
            setEntries([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadEntries();
        // A channel's handle or name caught up with YouTube (BiographyModal), or an edit elsewhere.
        const reload = () => { void loadEntries(); };
        window.addEventListener(BIOGRAPHY_CHANGED_EVENT, reload);
        return () => window.removeEventListener(BIOGRAPHY_CHANGED_EVENT, reload);
    }, []);

    // The search bar's Drive chip ("drive::MWD-JOHN"): creators with videos filed in that Drive or below it. Each
    // creator's Drives are looked up when a chip is set.
    const driveFilter = searchQuery.match(/(?:^|\s)drive:(\S+)/)?.[1]?.toUpperCase() ?? null;
    const [creatorDrives, setCreatorDrives] = useState<Record<string, string[]> | null>(null);
    useEffect(() => {
        if (!driveFilter) return;
        let live = true;
        getBiographyDrives().then(d => { if (live) setCreatorDrives(d); }).catch(() => { if (live) setCreatorDrives({}); });
        return () => { live = false; };
    }, [driveFilter]);

    const filtered = useMemo(() => {
        const isBioSearch = searchQuery.includes('bio_search:');
        const q = normalizeText(searchQuery.replace(/(?:^|\s)drive:\S+/g, ' ').replace(/person_search:/g, '').replace(/bio_search:/g, '').replace(/"/g, '').trim());
        // In the Drive, or a Drive under it (":MWD" takes in ":MWD-JOHN", not ":MWDX").
        const inDrive = (item: BiographyEntry) => {
            if (!driveFilter) return true;
            const drives = creatorDrives?.[item.handle.replace(/^@/, '').toLowerCase()] ?? [];
            return drives.some(d => { const u = d.toUpperCase(); return u === driveFilter || u.startsWith(`${driveFilter}-`); });
        };
        if (!q && !driveFilter) return entries;
        return entries.filter((item) => {
            if (!inDrive(item)) return false;
            if (!q) return true;
            if (isBioSearch) return normalizeText(item.bio || '').includes(q);
            return normalizeText(`${item.alias} ${item.displayName} ${item.handle}`).includes(q);
        });
    }, [entries, searchQuery, driveFilter, creatorDrives]);

    const grouped = useMemo(() => {
        const groups: Record<string, BiographyEntry[]> = {};
        const sorted = [...filtered].sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }));
        for (const item of sorted) {
            const first = nameOf(item).charAt(0).toUpperCase();
            const key = /[A-Z]/.test(first) ? first : '#';
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        }
        return groups;
    }, [filtered, showAlias]); // eslint-disable-line react-hooks/exhaustive-deps

    const groupKeys = Object.keys(grouped).sort((a, b) => {
        if (a === '#') return -1;
        if (b === '#') return 1;
        return a.localeCompare(b);
    });

    const commitSave = async (entry: BiographyEntry) => {
        // Normalize social fields: convert handles to full URLs where needed
        // A [5:50] typed straight after a video link becomes that link's ?t= (lib/internal-links.ts).
        const normalized = { ...entry, alias: entry.alias.trim(), bio: foldVideoLinkTimes(entry.bio) };
        (socialTabs as SocialTab[]).forEach((key) => {
            const val = entry[key];
            if (val && val.trim()) {
                normalized[key] = normalizeSocialValue(key, val.trim());
            }
        });

        await updateBiography(normalized);
        // The Handle tab's new capitals, after the rest is saved (that's keyed by the handle as it was).
        if (handleChanged) {
            try {
                normalized.handle = await setBiographyHandleCase(entry.handle, handleDraft.trim());
            } catch (e) {
                setHandleSaveError(String(e));
                setNameTab('handle');
                await loadEntries();
                return;
            }
        }
        closeEdit();
        // Opened from its biography window: that comes back showing the saved changes.
        setSelected(prev => (prev && handleKey(prev.handle) === handleKey(normalized.handle) ? normalized : prev));
        await loadEntries();
        onChange?.();
    };

    const saveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        await submitEdit();
    };

    const submitEdit = async () => {
        if (!editing) return;
        if (handleError) { setNameTab('handle'); return; }

        const candidates = detectSocialCandidates(editing.bio || '', editing);
        if (candidates.length > 0) {
            setPendingSocialPins(candidates);
            return;
        }
        await commitSave(editing);
    };

    // The bottom panel exists even before there's anything to jump to, same as it does for an
    // empty filtered view — no popping in once entries actually load.
    if (loading) return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-400">
            <div className="flex justify-between items-center min-h-9 mb-4 px-2">
                <h2 className="text-xl font-bold text-white">{labels.aliasBiography}</h2>
            </div>
            <div className="px-2">
                <div className="text-center text-gray-500 py-24 bg-[#121212] rounded-xl border border-[#272727]">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-sm">Loading biographies...</p>
                </div>
            </div>
            <AlphabetJumpNav idPrefix="biography-az" available={[]} scrollContainerRef={scrollContainerRef} />
        </div>
    );

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-400">
            {/* sticky top-0 (solid bg — this scrolls within App.tsx's shared content pane) keeps
                the heading visible instead of scrolling past with the list beneath it. */}
            <div className="sticky top-0 z-10 bg-[#0f0f0f] flex justify-between items-center min-h-9 mb-4 px-2">
                <h2 className="text-xl font-bold text-white">{labels.aliasBiography}</h2>
            </div>

            {/* pb-20: room at the very bottom for the floating back-to-top button (App.tsx), so it never sits
                on a row's edit/delete icons once scrolled all the way down. (AlphabetJumpNav, below, is a true fixed panel, always present, no longer part
                of this page's own scroll — its ~24px height has to be reserved here instead, or
                it'd sit over the last section once scrolled all the way down. */}
            <div className="px-2 pb-20">
                {entries.length === 0 ? (
                    <div className="text-center text-gray-500 py-24 bg-[#121212] rounded-xl border border-[#272727]">
                        <p className="text-xl font-bold text-white mb-2">No people yet</p>
                        <p className="text-sm">People are added automatically when videos with handles are saved.</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center text-gray-500 py-24 bg-[#121212] rounded-xl border border-[#272727]">
                        <p className="text-xl font-bold text-white mb-2">No people found</p>
                        <p className="text-md">No biographies match your search.</p>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {groupKeys.map((char) => (
                            <div key={char}>
                                <h3 id={`biography-az-${char}`} className="text-xl font-bold text-[#aaaaaa] border-b border-[#333] pb-2 mb-4 scroll-mt-4">{char}</h3>
                        <ul className="space-y-1.5 pl-2">
                            {grouped[char].map((person) => (
                                <li key={person.handle} className="text-gray-300 group flex items-center">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#444] mr-3 shrink-0 group-hover:bg-[var(--k-accent)] transition-colors"></div>
                                     {/* data-preview-anchor: the name's hover preview opens past the edit icon, not over it. */}
                                     <div data-preview-anchor className="flex items-center min-w-0">
                                     <PersonName person={person} showAlias={showAlias} aliasOnly={aliasOnly} onOpen={() => setSelected(person)} />
                                     {/* Hidden until the row is hovered (or it has keyboard focus), right after the name. */}
                                     {allowEditBio !== false && (
                                         <button
                                             onClick={(e) => {
                                                 e.stopPropagation();
                                                 startEdit(person);
                                             }}
                                             className="ml-1.5 text-gray-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer p-1"
                                             title="Edit bio"
                                         >
                                             <Pencil className="w-3.5 h-3.5" />
                                         </button>
                                     )}
                                     </div>
                                </li>
                            ))}
                        </ul>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <AlphabetJumpNav
                idPrefix="biography-az"
                available={groupKeys}
                scrollContainerRef={scrollContainerRef}
                trailing={
                    <div className="flex items-center gap-1">
                        <BarSwitch
                            label="Show Alias"
                            on={showAlias}
                            onChange={setShowAlias}
                            title={showAlias ? 'Aliases show, and the list goes by them' : "Aliases are hidden, and the list goes by the channels' own names"}
                        />
                        <BarSwitch
                            label="Alias Only"
                            on={aliasOnly}
                            onChange={setAliasOnly}
                            disabled={!showAlias}
                            title={!showAlias ? 'Turn on Show Alias first' : aliasOnly ? "A channel with an alias shows just its alias" : "A channel with an alias shows its own name after it"}
                        />
                    </div>
                }
            />

            {/* Stepped aside while this person's biography is being edited, and back (with the saved changes)
                once the edit's done. */}
            {selected && !editing && (
                <BiographyModal
                    biography={selected}
                    onClose={() => setSelected(null)}
                    onVideoSelect={(video) => {
                        setSelected(null);
                        onVideoSelect?.(video);
                    }}
                    onEdit={() => startEdit(selected)}
                    onChanged={setSelected}
                    onViewMore={onViewMore}
                    onDriveSelect={onDriveSelect}
                    allowEditBio={allowEditBio}
                />
            )}

            {editing && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-200" {...backdropProps(requestCloseEdit)}>
                    <form onSubmit={saveEdit} onClick={(e) => e.stopPropagation()} className="bg-[#0f0f0f] border border-[#303030] rounded-2xl w-full max-w-4xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-[#303030] flex items-center justify-between bg-[#141414]">
                            <div className="text-gray-200">
                                <h2 className="text-lg font-bold">Edit {labels.aliasBiographyItem}</h2>
                                <p className="text-xs text-gray-400">{editing.displayName || editing.handle} ({editing.handle})</p>
                            </div>
                            <button type="button" onClick={requestCloseEdit} className="text-gray-500 hover:text-white transition-colors cursor-pointer">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 max-h-[75vh] overflow-y-auto">
                            {/* What the channel is called: its alias (optional, the reader's own name for it) and its handle,
                                whose capitals can be changed (@john to @John) but not its letters. */}
                            <div className="mb-6">
                                <UnderlineTabs
                                    className="flex items-center gap-4 mb-3"
                                    active={nameTab}
                                    onChange={setNameTab}
                                    tabs={[
                                        { id: 'alias', label: 'Alias', icon: BadgeCheck },
                                        { id: 'handle', label: 'Handle Casing', icon: CaseSensitive, title: "Change the capitals in the channel's handle" },
                                    ]}
                                />
                                {nameTab === 'alias' ? (
                                    <>
                                        <input
                                            type="text"
                                            value={editing.alias}
                                            onChange={(e) => setEditing(prev => prev && { ...prev, alias: e.target.value })}
                                            onContextMenu={handlePlainContextMenu}
                                            maxLength={80}
                                            className="w-full bg-[#121212] border border-[#333] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-600 transition-all placeholder-gray-600"
                                            placeholder={`Optional, e.g. the person behind ${editing.displayName || editing.handle}`}
                                        />
                                        <p className="text-[11px] text-gray-500 mt-1.5">Optional. Shows as a badge before the channel's name, here and in a summary's Channel Info.</p>
                                    </>
                                ) : (
                                    <>
                                        <input
                                            type="text"
                                            value={handleDraft}
                                            onChange={(e) => { setHandleDraft(e.target.value); setHandleSaveError(null); }}
                                            onContextMenu={handlePlainContextMenu}
                                            spellCheck={false}
                                            aria-invalid={!!handleError}
                                            className={`w-full bg-[#121212] border text-white rounded-xl px-4 py-3 text-sm font-mono focus:outline-none transition-all ${handleError ? 'border-red-500/70 focus:border-red-500' : 'border-[#333] focus:border-blue-600'}`}
                                        />
                                        <p className={`text-[11px] mt-1.5 ${handleError || handleSaveError ? 'text-red-400' : 'text-gray-500'}`}>
                                            {handleSaveError ?? handleError ?? "The channel's YouTube handle. Only its capitals can change, like @john to @John; links and videos follow."}
                                        </p>
                                    </>
                                )}
                            </div>

                            {/* Bio - largest section */}
                            <div className="mb-6">
                                <MarkdownField
                                    label="Description"
                                    autoFocus
                                    value={editing?.bio || ''}
                                    onChange={(val) => setEditing(prev => prev && { ...prev, bio: val })}
                                    rows={16}
                                    placeholder="Describe who this person is (Markdown supported)... Tip: paste your existing YouTube channel description here as a starting point."
                                />
                            </div>

                            {/* Social Tabs */}
                            <div className="mb-4">
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Socials</label>
                                <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-[#333] scrollbar-track-transparent">
                                    {socialTabs.map((tab) => {
                                        const config = socialTabConfig[tab];
                                        const Icon = config.icon;
                                        const isActive = activeSocialTab === tab;
                                        return (
                                             <button
                                                 key={tab}
                                                 type="button"
                                                 onClick={() => setActiveSocialTab(tab)}
                                                 title={config.label}
                                                  className={`flex items-center justify-center w-10 h-10 rounded-lg shrink-0 transition-colors cursor-pointer ${
                                                      isActive
                                                          ? 'bg-blue-600'
                                                          : 'bg-[#1b1b1b] border border-[#333] text-gray-400 hover:text-white hover:bg-[#262626]'
                                                  }`}
                                             >
                                                 <Icon className="w-5 h-5" />
                                             </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Active Social Input */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">
                                    {socialTabConfig[activeSocialTab].label}
                                </label>
                                <input
                                    type="text"
                                    value={editing ? (editing[activeSocialTab] || '') : ''}
                                    onChange={(e) => setEditing({ ...editing, [activeSocialTab]: e.target.value })}
                                    onContextMenu={handlePlainContextMenu}
                                    className="w-full bg-[#121212] border border-[#333] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-600 transition-all placeholder-gray-600"
                                    placeholder={socialTabConfig[activeSocialTab].placeholder}
                                />
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-[#303030] flex justify-end gap-3 bg-[#141414]">
                            <SecondaryButton onClick={closeEdit}>Cancel</SecondaryButton>
                            <button type="submit" disabled={!!handleError} className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 transition-all text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Save {labels.aliasBiographyItem}</button>
                        </div>
                    </form>

                    {pendingSocialPins && (
                        // stopPropagation: a click out here backs out of just this prompt, not the edit behind it.
                        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-200" {...backdropProps(() => setPendingSocialPins(null), { stop: true })}>
                            <div onClick={(e) => e.stopPropagation()} className="bg-[#0f0f0f] border border-[#303030] rounded-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                                <div className="px-6 py-4 border-b border-[#303030] bg-[#141414]">
                                    <h3 className="text-base font-bold text-white">Social{pendingSocialPins.length > 1 ? 's' : ''} detected</h3>
                                    <p className="text-xs text-gray-400 mt-1">Would you like to pin the following?</p>
                                </div>
                                <ul className="px-6 py-4 space-y-2.5 max-h-64 overflow-y-auto">
                                    {pendingSocialPins.map((p) => {
                                        const Icon = socialConfig[p.platform].icon;
                                        return (
                                            <li key={p.platform} className="flex items-center gap-2.5 text-sm">
                                                <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                                                <span className="font-semibold text-white shrink-0">{socialConfig[p.platform].label}:</span>
                                                <span className="text-gray-400 truncate">{p.normalized}</span>
                                            </li>
                                        );
                                    })}
                                </ul>
                                <div className="px-6 py-4 border-t border-[#303030] flex justify-end gap-3 bg-[#141414]">
                                    <SecondaryButton onClick={() => commitSave(editing)}>Just Save</SecondaryButton>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const merged = { ...editing };
                                            pendingSocialPins.forEach((p) => { merged[p.platform] = p.normalized; });
                                            commitSave(merged);
                                        }}
                                        className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 transition-all text-sm font-bold cursor-pointer"
                                    >
                                        Pin & Save
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {confirmClose && (
                <UnsavedChangesModal
                    message={<>You have unsaved changes to this {labels.aliasBiographyItem.toLowerCase()}. Save them before closing?</>}
                    onCancel={() => setConfirmClose(false)}
                    onDiscard={() => { setConfirmClose(false); closeEdit(); }}
                    onSave={() => { setConfirmClose(false); void submitEdit(); }}
                />
            )}
        </div>
    );
}

export function BiographyModal({ biography: given, onClose, onVideoSelect, onEdit, onChanged, onViewMore, onDriveSelect, allowEditBio }: { biography: BiographyEntry; onClose: () => void; onVideoSelect?: (video: Video) => void; onEdit?: () => void; onChanged?: (updated: BiographyEntry) => void; onViewMore?: (handle: string) => void; onDriveSelect?: (path: string, label: string) => void; allowEditBio?: boolean }) {
    // Kept here as well as in the caller's hands: catching up with YouTube (below) can change its handle and name.
    const [biography, setBiography] = useState(given);
    useEffect(() => { setBiography(given); }, [given]);
    // Each time the window is viewed (not while it's stepped aside for Edit Bio), the channel is looked up on YouTube by
    // its channel ID (no API key): a new handle is taken over right away (and said here); a new name asks whether to
    // keep the old one as the alias. In a read-only workspace both are simply taken over, with no alias and no asking.
    const [renamedFrom, setRenamedFrom] = useState<string | null>(null);
    const [nameChange, setNameChange] = useState<{ handle: string; from: string; to: string } | null>(null);
    const { flags: modalFlags } = useFlags();
    const readOnly = modalFlags.workspaceReadOnly;
    useEffect(() => {
        const key = given.handle.toLowerCase();
        if (identityChecking.has(key)) return;
        identityChecking.add(key);
        // Not cancelled on unmount: React's development double-run would otherwise drop the one check that ran, and
        // a late answer to a closed window does no harm.
        checkChannelIdentity(given.handle)
            .then(async result => {
                if (result.newDisplayName && result.oldDisplayName && readOnly) {
                    await renameBiographyDisplayName(result.handle, result.newDisplayName, false);
                }
                const fresh = result.renamedFrom || (readOnly && result.newDisplayName) ? await getBiography(result.handle) : null;
                if (fresh) {
                    setBiography(fresh);
                    onChanged?.(fresh);
                }
                if (result.renamedFrom) setRenamedFrom(result.renamedFrom);
                if (!readOnly && result.newDisplayName && result.oldDisplayName) {
                    setNameChange({ handle: result.handle, from: result.oldDisplayName, to: result.newDisplayName });
                }
            })
            .catch(e => console.warn('Channel check skipped:', e)) // offline, or YouTube didn't answer: tried again next view
            .finally(() => identityChecking.delete(key));
    }, [given.handle]); // eslint-disable-line react-hooks/exhaustive-deps
    const answerNameChange = async (keepOldAsAlias: boolean) => {
        if (!nameChange) return;
        const { handle, to } = nameChange;
        setNameChange(null);
        try {
            await renameBiographyDisplayName(handle, to, keepOldAsAlias);
            const fresh = await getBiography(handle);
            if (fresh) { setBiography(fresh); onChanged?.(fresh); }
        } catch (e) {
            console.error('Failed to take the channel\'s new name:', e);
        }
    };
    const title = biography.displayName.trim() || biography.handle;
    const [videos, setVideos] = useState<Video[]>([]);
    const [loadingVideos, setLoadingVideos] = useState(true);
    // How many texts link to this person, once its Backlinks list has looked.
    const [backlinkCount, setBacklinkCount] = useState<number | null>(null);
    const [drives, setDrives] = useState<HandleDrive[]>([]);
    const { flags } = useFlags();
    const { labels } = useWorkspace();
    // The description can be selected, and copied as plain text or markdown from a right-click.
    const selectable = useSelectableText();

    const activeSocials = socialOrder.filter(key => getSocialValue(biography, key));

    useEffect(() => {
        let cancelled = false;
        const loadVideos = async () => {
            setLoadingVideos(true);
            try {
                const response = await fetchChannelVideosV3(biography.handle);
                if (!cancelled) {
                    setVideos(response.videos.slice(0, 5)); // Show latest 5 videos
                }
            } catch (error) {
                console.error('Failed to load channel videos:', error);
                if (!cancelled) {
                    setVideos([]);
                }
            } finally {
                if (!cancelled) {
                    setLoadingVideos(false);
                }
            };
        };

        loadVideos();
        return () => {
            cancelled = true;
        };
    }, [biography.handle]);

    // The Drives this channel's saved videos are filed under. Skipped when the DB owner hides Drives.
    useEffect(() => {
        if (!flags.showDrive) {
            setDrives([]);
            return;
        }
        let cancelled = false;
        getHandleDrives(biography.handle)
            .then(result => { if (!cancelled) setDrives(result); })
            .catch(error => {
                console.error('Failed to load related drives:', error);
                if (!cancelled) setDrives([]);
            });
        return () => {
            cancelled = true;
        };
    }, [biography.handle, flags.showDrive]);

    const handleVideoClick = (video: Video) => {
        onClose();
        onVideoSelect?.(video);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-200" {...backdropProps(onClose)}>
            <div onClick={(e) => e.stopPropagation()} className="bg-[#0f0f0f] border border-[#303030] rounded-2xl w-full max-w-7xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 h-[90vh]">
                        <div className="px-6 py-4 border-b border-[#303030] flex items-center justify-between bg-[#141414]">
                    {/* min-w-0: the names give way (the title ends in "...") rather than the buttons on the right. */}
                    <div className="flex items-center gap-3 pr-4 overflow-hidden min-w-0">
                        <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                        {/* Always shown here (Show Alias only governs the list): this is the channel's own window. */}
                        {biography.alias.trim() && <AliasBadge alias={biography.alias.trim()} displayName={biography.displayName || biography.handle} className="text-base shrink-0" />}
                        <h2 className="text-xl font-bold text-white truncate">{title}</h2>
                        <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">{biography.handle}</span>
                        {renamedFrom && (
                            <span className="text-[11px] text-gray-500 shrink-0" title="The channel changed its handle on YouTube; its videos and links here follow it.">
                                (was {renamedFrom})
                            </span>
                        )}
                    </div>
                     <div className="flex items-center gap-2 shrink-0">
                         {onEdit && allowEditBio !== false && (
                             <button onClick={onEdit} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 cursor-pointer whitespace-nowrap">
                                 Edit {labels.aliasBiographyItem}
                             </button>
                         )}
                         <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors cursor-pointer">
                             <X className="w-5 h-5" />
                         </button>
                     </div>
                </div>

                  <div className="flex-1 flex flex-col lg:flex-row min-h-0">
                      {/* Main Content: Bio */}
                       {/* Two parts: the description, which scrolls, and Backlinks pinned along the bottom (scrolling on
                           its own past 40% of the column), so they're in view however long the description is. */}
                       <div className="flex-1 min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-[#272727]">
                       <div className="flex-1 min-h-0 overflow-y-auto p-6">
                           <h3 className="text-lg font-bold text-white mb-4">About</h3>
                           {/* Font size/markdown look-and-feel kept in parity with the video Summary panel
                               (prose-sm — see Sidebar.tsx) rather than the previous prose-lg, which read
                               oversized next to it. */}
                           <div {...selectable.props} className={`${SELECTABLE_CLASS} leading-relaxed prose dark:prose-invert prose-sm max-w-none prose-pre:bg-black/50 prose-code:text-red-400`}>
                               <ReactMarkdown
                                   remarkPlugins={[remarkGfm, remarkHighlight, [remarkTimestamps, { chips: false }], remarkEmbeds]}
 urlTransform={markdownUrlTransform}
                                   components={{
                                       a: MarkdownLink,
                                       img: ({ node, ...props }) => (
                                           <img
                                               {...props}
                                               className="rounded-xl border border-white/10"
                                           />
                                       )
                                   }}
                               >
                                   {biography.bio?.trim() || '_No biography yet._'}
                               </ReactMarkdown>
                           </div>
                           {selectable.menu}
                       </div>
                       {/* What else mentions this person with a link (components/BacklinksList.tsx). */}
                       <div className="shrink-0 max-h-[40%] overflow-y-auto border-t border-[#272727] px-6 py-4">
                           <h3 className="text-sm font-bold text-white mb-2">Backlinks{backlinkCount ? ` (${backlinkCount})` : ''}</h3>
                           <BacklinksList key={biography.handle} kind="bio" targetKey={biography.handle} onCount={setBacklinkCount} />
                       </div>
                       </div>

                       {/* Sidebar Content: Latest Videos — kept narrower than the About panel gets wide
                           (was w-96) so About has more horizontal room for markdown text. */}
                       <div className="w-full lg:w-80 bg-[#0f0f0f] flex flex-col p-6 space-y-4 overflow-y-auto">
                          <div className="flex items-center justify-between mb-4 shrink-0">
                              <h3 className="text-lg font-bold text-white">Latest Videos</h3>
                             {videos.length > 0 && (
                                 <button
                                     onClick={() => {
                                         onViewMore?.(biography.handle);
                                         onClose();
                                     }}
                                      className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors cursor-pointer p-1"
                                 >
                                     View More
                                 </button>
                             )}
                         </div>

                         {loadingVideos ? (
                             <div className="flex items-center justify-center py-8">
                                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                             </div>
                         ) : videos.length === 0 ? (
                              <div className="text-center text-gray-500 py-8">
                                 <p>No videos found for this channel</p>
                             </div>
                         ) : (
                             <div className="space-y-3 shrink-0">
                                 {videos.map((video) => (
                                     <div
                                         key={video.id}
                                         onClick={() => handleVideoClick(video)}
                                         className="cursor-pointer flex gap-3 py-1"
                                     >
                                         {video.thumbnail ? (
                                             <img
                                                 src={video.thumbnail}
                                                 alt={video.title}
                                                 className="w-24 h-16 object-cover rounded-lg shrink-0"
                                             />
                                         ) : (
                                             <div className="w-24 h-16 bg-[#272727] rounded-lg flex items-center justify-center shrink-0">
                                                 <span className="text-xs text-gray-500">No Thumbnail</span>
                                             </div>
                                         )}
                                          <h4 className="text-sm text-white leading-tight flex-1">{video.title}</h4>
                                     </div>
                                 ))}
                             </div>
                         )}

                         {drives.length > 0 && (
                             <div className="pt-4 border-t border-[#272727] flex flex-col lg:flex-1 lg:min-h-[10rem]">
                                 <h3 className="text-lg font-bold text-white mb-3 shrink-0">In {labels.aliasDriveName}</h3>
                                 <ul className="space-y-1 overflow-y-auto max-h-64 lg:max-h-none lg:flex-1 lg:min-h-0 pr-1">
                                     {drives.map((drive) => {
                                         // Hovering shows the Drive's alias (falling back to its path when it has none).
                                         const tooltip = drive.alias ?? drive.display;
                                         const content = (
                                             <>
                                                 <span className="text-gray-200 truncate">{drive.display}</span>
                                                 <span className="text-xs text-gray-500 shrink-0">{drive.count} video{drive.count === 1 ? '' : 's'}</span>
                                             </>
                                         );
                                         return (
                                             <li key={drive.path}>
                                                 {onDriveSelect ? (
                                                     <button
                                                         onClick={() => onDriveSelect(drive.path, driveSegmentLabel(drive.display))}
                                                         className="w-full flex items-center justify-between gap-3 text-sm text-left px-2 py-1.5 rounded-lg hover:bg-[#272727] transition-colors cursor-pointer"
                                                         title={tooltip}
                                                     >
                                                         {content}
                                                     </button>
                                                 ) : (
                                                     <div className="flex items-center justify-between gap-3 text-sm px-2 py-1.5" title={tooltip}>{content}</div>
                                                 )}
                                             </li>
                                         );
                                     })}
                                 </ul>
                             </div>
                         )}
                     </div>
                </div>

                {nameChange && (
                    <Modal
                        onClose={() => setNameChange(null)}
                        layer="top"
                        title="Channel Renamed"
                        footer={
                            <>
                                <SecondaryButton onClick={() => { void answerNameChange(false); }}>No</SecondaryButton>
                                <button
                                    type="button"
                                    onClick={() => { void answerNameChange(true); }}
                                    className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 transition-all text-sm font-bold text-white cursor-pointer"
                                >
                                    Yes
                                </button>
                            </>
                        }
                    >
                        <p className="text-[#aaaaaa] leading-relaxed">
                            <span className="text-white font-semibold">{nameChange.from}</span> is now called{' '}
                            <span className="text-white font-semibold">{nameChange.to}</span> on YouTube.
                        </p>
                        <p className="text-[#aaaaaa] leading-relaxed mt-3">
                            Keep "{nameChange.from}" as its alias, so it's still easy to recognize?
                            {biography.alias.trim() && <> This replaces its alias, "{biography.alias.trim()}".</>}
                        </p>
                        <p className="text-[11px] text-gray-500 mt-3">Either way, it takes the new name.</p>
                    </Modal>
                )}

                {/* Sticky Footer: Social Icons — kept small and low-emphasis so the bio itself is
                    the thing that draws the eye, not the row of links below it. */}
                {activeSocials.length > 0 && (
                    <div className="flex-shrink-0 border-t border-[#272727] bg-[#0f0f0f] px-6 py-2">
                        <div className="flex flex-wrap gap-1.5">
                            {activeSocials.map((key) => {
                                const config = socialConfig[key];
                                const Icon = config.icon;
                                const rawValue = getSocialValue(biography, key);
                                return (
                                     <button
                                         key={key}
                                          onClick={() => openExternalUrlGuarded(rawValue, config.label)}
                                         title={config.label}
                                         className="flex items-center justify-center w-7 h-7 rounded-md bg-[#1b1b1b] border border-[#333] text-gray-400 hover:text-white hover:bg-[#262626] hover:border-blue-600/50 transition-all cursor-pointer"
                                     >
                                        <Icon className="w-3.5 h-3.5" />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
