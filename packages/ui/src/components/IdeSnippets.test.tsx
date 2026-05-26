import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// fetchServerInfo() has a module-level cache that survives across tests —
// mock the whole module so each test gets a fresh, configurable answer.
vi.mock('../api/info', () => ({
    fetchServerInfo: vi.fn(),
}));

import { IdeSnippets } from './IdeSnippets';
import { fetchServerInfo } from '../api/info';

const mockFetchServerInfo = vi.mocked(fetchServerInfo);

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
    mockFetchServerInfo.mockReset();
    writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom doesn't ship navigator.clipboard out of the box
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('IdeSnippets — initial rendering', () => {
    it('starts on the Zed tab and renders its JSON snippet', async () => {
        mockFetchServerInfo.mockResolvedValue({
            binaryPath: '/opt/homebrew/bin/acp-devtools',
            platform: 'darwin',
            arch: 'arm64',
        });
        render(<IdeSnippets />);
        expect(
            await screen.findByText(/Claude Code \(via ACP Devtools\)/),
        ).toBeInTheDocument();
        // JetBrains-specific text isn't visible yet
        expect(screen.queryByText(/Settings \(Cmd\+,\)/)).toBeNull();
    });

    it('embeds the resolved binary path into the Zed snippet', async () => {
        mockFetchServerInfo.mockResolvedValue({
            binaryPath: '/usr/local/bin/acp-devtools',
            platform: 'linux',
            arch: 'x64',
        });
        const { container } = render(<IdeSnippets />);
        await waitFor(() => {
            const pre = container.querySelector('pre');
            expect(pre?.textContent).toContain('/usr/local/bin/acp-devtools');
        });
    });

    it('falls back to the placeholder path when /api/info returns null', async () => {
        mockFetchServerInfo.mockResolvedValue({
            binaryPath: null,
            platform: 'darwin',
            arch: 'arm64',
        });
        const { container } = render(<IdeSnippets />);
        expect(
            await screen.findByText(/viewing the UI through a development server/i),
        ).toBeInTheDocument();
        await waitFor(() => {
            const pre = container.querySelector('pre');
            expect(pre?.textContent).toContain('/absolute/path/to/acp-devtools');
        });
    });

    it('falls back to placeholder when fetchServerInfo rejects', async () => {
        mockFetchServerInfo.mockRejectedValue(new Error('network'));
        const { container } = render(<IdeSnippets />);
        await waitFor(() => {
            const pre = container.querySelector('pre');
            expect(pre?.textContent).toContain('/absolute/path/to/acp-devtools');
        });
    });
});

describe('IdeSnippets — tab switching', () => {
    it('switching to JetBrains shows the field-based UI, not the JSON pre', async () => {
        mockFetchServerInfo.mockResolvedValue({
            binaryPath: '/opt/homebrew/bin/acp-devtools',
            platform: 'darwin',
            arch: 'arm64',
        });
        const user = userEvent.setup();
        render(<IdeSnippets />);
        await screen.findByText(/Claude Code \(via ACP Devtools\)/);

        await user.click(screen.getByRole('button', { name: /JetBrains/i }));

        expect(screen.getByText(/Settings \(Cmd\+,\)/)).toBeInTheDocument();
        expect(screen.getByText('Command')).toBeInTheDocument();
        expect(screen.getByText('Name')).toBeInTheDocument();
    });
});

describe('IdeSnippets — copy button', () => {
    it('copies the Zed snippet to clipboard and flashes "Copied"', async () => {
        mockFetchServerInfo.mockResolvedValue({
            binaryPath: '/opt/homebrew/bin/acp-devtools',
            platform: 'darwin',
            arch: 'arm64',
        });
        render(<IdeSnippets />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /^Copy$/i })).toBeInTheDocument(),
        );

        fireEvent.click(screen.getByRole('button', { name: /^Copy$/i }));

        await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
        const written = writeText.mock.calls[0]?.[0] as string;
        expect(written).toMatch(/agent_servers/);
        expect(written).toMatch(/\/opt\/homebrew\/bin\/acp-devtools/);

        expect(await screen.findByText('Copied')).toBeInTheDocument();
    });

    it('does not crash when clipboard.writeText rejects', async () => {
        writeText = vi.fn().mockRejectedValue(new Error('denied'));
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        mockFetchServerInfo.mockResolvedValue({
            binaryPath: '/opt/homebrew/bin/acp-devtools',
            platform: 'darwin',
            arch: 'arm64',
        });
        render(<IdeSnippets />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /^Copy$/i })).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByRole('button', { name: /^Copy$/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalled());
        // After a rejected write, the button label stays "Copy"
        expect(screen.getByRole('button', { name: /^Copy$/i })).toBeInTheDocument();
    });
});
