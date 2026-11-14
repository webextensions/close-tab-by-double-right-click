import {
    TEST_ORIGIN,
    expect,
    test
} from './fixtures.js';

test('failing to inject the content script into a browser error page is not logged as an error', async ({ context, serviceWorker }) => {
    const messages = [];
    serviceWorker.on('console', (message) => {
        messages.push({ type: message.type(), text: message.text() });
    });

    // The request fails, so the tab shows a browser error page, which extensions cannot script
    const url = `${TEST_ORIGIN}/unreachable`;
    await context.route(url, (route) => route.abort('connectionrefused'));
    const page = await context.newPage();
    await expect(page.goto(url)).rejects.toThrow();

    await expect.poll(() => {
        return messages.some((message) => message.type === 'debug' && message.text.includes('Could not inject the content script'));
    }).toBe(true);
    expect(messages.filter((message) => message.type === 'error')).toEqual([]);
});
