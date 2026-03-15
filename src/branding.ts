import KinesisLogo from './assets/kinesis.png';
import GenesisLogo from './assets/genesis.png';

export type Brand = 'kinesis' | 'genesis';

// Default to Kinesis unless specified in env
const BRANDING_ID = (import.meta.env.VITE_BRANDING as Brand) || 'kinesis';

interface BrandConfig {
    id: Brand;
    name: string;
    tagline: string;
    logo: string;
    repo: string;
    dbName: string;
    storageKey: string;
}

const BRANDS: Record<Brand, BrandConfig> = {
    genesis: {
        id: 'genesis',
        name: 'Genesis',
        tagline: 'YouTube Transcript Manager',
        logo: GenesisLogo,
        repo: 'https://github.com/willnjohnson/genesis',
        dbName: 'genesis_data.db',
        storageKey: 'genesis_db_path'
    },
    kinesis: {
        id: 'kinesis',
        name: 'Kinesis',
        tagline: 'Metabolic Warp Drive',
        logo: KinesisLogo,
        repo: 'https://github.com/willnjohnson/kinesis',
        dbName: 'kinesis_data.db',
        storageKey: 'kinesis_db_path'
    }
};

export const BRAND = BRANDS[BRANDING_ID];
