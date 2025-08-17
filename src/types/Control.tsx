export interface CommandResponse {
    success: boolean;
    message: string;
}

export interface ParsedCommand {
    action: string;
    target: string;
}

export interface ChromeControlOptions {
    url?: string;
    profile?: string;
    debug_port?: number;
}

export interface ChromeTarget {
    id: string;
    target_type: string;
    title: string;
    url: string;
    websocket_debugger_url: string;
}

export interface ChromeSession {
    debug_port: number;
    session_id: string;
}

export interface PageElement {
    hint: string;
    tag_name: string;
    element_type: string;
    text: string;
    href?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
    selector: string;
}

export interface PageHints {
    elements: PageElement[];
    total_count: number;
    visible_count: number;
}

export interface ElementAction {
    hint: string;
    action_type: string;
    modifier_keys?: string[];
}